import { useEffect, useRef, useState } from "react";
import { IconGear } from "../components/Icons";
import { api, ApiError } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";
import type { AppConfig, ChatTurn, CourseSummary, DriverStatus, ReadyBuild } from "../lib/types";

interface Props {
  drivers: DriverStatus[];
  config: AppConfig;
  onBuilding: (course: CourseSummary) => void;
}

/** Ceiling for the auto-growing composer. Kept in step with .composer textarea's
 *  max-height, which is the guard for the frame before this measures. */
const COMPOSER_MAX_PX = 160;

const SUGGESTIONS = [
  { badge: "Science", title: "How ferrofluids work", color: "#769826" },
  { badge: "History", title: "The French Revolution", color: "#ffde4e" },
  { badge: "Math", title: "Bayesian statistics", color: "#a1cb35" },
  { badge: "Games", title: "Chess openings", color: "#ff9d4d" },
  { badge: "CS", title: "How compilers work", color: "#769826" },
  { badge: "AI", title: "How transformers work", color: "#769826" },
];

/**
 * What the agent is doing while you wait.
 *
 * A single fixed "Thinking…" reads as a stall the moment it outlasts your
 * patience — the word never changes, so nothing on screen distinguishes a
 * working request from a wedged one. Rotating copy does, and camp does the
 * theming for free: every one of these is something you would actually be doing
 * out there, and all of them are the kind of unhurried work that takes a minute.
 *
 * Kept intransitive and object-free so none of them implies a specific step —
 * this same wait covers the first question of an interview and the last.
 */
const THINKING_VERBS = [
  "Whittling",
  "Kindling",
  "Foraging",
  "Scouting ahead",
  "Reading the map",
  "Tying knots",
  "Stoking the fire",
  "Gathering kindling",
  "Blazing the trail",
  "Checking the compass",
  "Pitching the tent",
  "Sharpening the axe",
  "Following tracks",
  "Fetching water",
  "Counting rings",
  "Skipping stones",
  "Toasting marshmallows",
  "Charting the route",
  "Lashing poles",
  "Portaging",
];

/** Long enough to read twice without staring, short enough to prove it is live. */
const VERB_ROTATE_MS = 2600;

const LEVEL_LABEL: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const CURATION_LABEL: Record<string, string> = {
  auto: "Built end to end",
  review: "Outline for review first",
  manual: "You write the outline",
};

/**
 * Course setup, as a conversation.
 *
 * This was a form: a topic box, a level segmented control, four numeric limits
 * and a research toggle behind a disclosure. Every one of those is a question
 * the agent is better placed to ask than the learner is to answer, because the
 * right answer depends on the topic — eight units of "Chess openings" and
 * eight units of "The French Revolution" are very different asks.
 *
 * The agent drives it. Each turn posts the whole transcript to /api/build/chat
 * and gets back prose plus, optionally, tappable replies or a finished setup.
 * Nothing is committed until the setup card's button is pressed.
 */
export function BuildScreen({ drivers, config, onBuilding }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [suggest, setSuggest] = useState<string[]>([]);
  const [ready, setReady] = useState<ReadyBuild | null>(null);
  const [thinking, setThinking] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [driver, setDriver] = useState(config.driver);
  const [model, setModel] = useState(config.model);
  const [effort, setEffort] = useState(config.effort);
  const [verb, setVerb] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const usable = drivers.filter((d) => d.supportsMcp);
  const noneAvailable = drivers.every((d) => !d.available || !d.supportsMcp);
  const started = turns.length > 0;

  // "auto" is resolved the same way the server resolves it — first installed
  // harness that can drive MCP — so the pill can name the CLI that will actually
  // run rather than the word "auto", and so the pickers below can offer that
  // CLI's own models instead of a generic list.
  const active = drivers.find((d) => d.id === driver) ?? usable.find((d) => d.available);
  const models = active?.models ?? [];
  const efforts = active?.efforts ?? [];

  // Grows the field to fit, up to the cap, then scrolls. Keyed off the draft
  // rather than the change event so a tapped suggestion resizes it too.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [draft]);

  // Pin to the newest message. Runs on `thinking` as well so the pending
  // indicator scrolls into view the moment it appears, not one turn late.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, thinking]);

  // Cycles the waiting copy. Each wait opens on a different word — otherwise
  // every turn starts with the same one and the list only reveals itself to
  // whoever waits longest — and advances from there, so the rotation is
  // recognisable rather than random noise.
  useEffect(() => {
    if (!thinking) return;
    setVerb(Math.floor(Math.random() * THINKING_VERBS.length));
    const id = window.setInterval(() => setVerb((v) => (v + 1) % THINKING_VERBS.length), VERB_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [thinking]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || thinking || (noneAvailable && !started)) return;

    const next: ChatTurn[] = [...turns, { role: "user", text: message }];
    setTurns(next);
    setDraft("");
    setSuggest([]);
    setReady(null);
    setError(null);
    setThinking(true);
    try {
      const reply = await api.chat({
        messages: next,
        ...(driver !== "auto" ? { driver } : {}),
        ...(model !== config.model ? { model } : {}),
        ...(effort !== config.effort ? { effort } : {}),
      });
      setTurns([...next, { role: "assistant", text: reply.text }]);
      setSuggest(reply.suggest);
      setReady(reply.ready ?? null);
    } catch (err) {
      // The user's message stays in the transcript so retrying doesn't mean
      // retyping it — the next send replays it along with everything else.
      setError(err instanceof ApiError ? [err.message, err.detail].filter(Boolean).join("\n") : "Couldn't reach the agent.");
    } finally {
      setThinking(false);
    }
  };

  const build = async () => {
    if (!ready || building) return;
    setBuilding(true);
    setError(null);
    try {
      if (ready.curation === "manual") {
        // No agent runs at all yet: this creates the shell and drops straight
        // into the outline editor with one starter unit to fill in.
        const { course } = await api.manualCreate({
          title: ready.title,
          level: ready.level,
          buildConfig: ready.buildConfig,
          units: [{ title: "Unit 1", description: "", lessons: [{ title: "Lesson 1", objective: "", kind: "concept" }] }],
        });
        onBuilding(course);
        return;
      }
      const { course } = await api.build({
        topic: ready.topic,
        level: ready.level,
        curation: ready.curation,
        buildConfig: ready.buildConfig,
        ...(ready.focus ? { focus: ready.focus } : {}),
        ...(driver !== "auto" ? { driver } : {}),
        ...(model !== config.model ? { model } : {}),
        ...(effort !== config.effort ? { effort } : {}),
      });
      onBuilding(course);
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, err.detail].filter(Boolean).join("\n") : "Something went wrong.");
      setBuilding(false);
    }
  };

  return (
    // Two different pages, really. Before the interview starts this is a centred
    // prompt that scrolls with the document like any other screen; once it does,
    // it becomes a fixed-height chat whose feed scrolls on its own.
    <div className={`page${started ? " page--chat" : ""}`}>
      <div className={`create${started ? " create--chat" : ""}`}>
        {!started && (
          <>
            <h1>What do you want to learn?</h1>
            <p>Tell it what you're curious about. It'll ask a couple of questions, then build the course.</p>

            {/* The list runs twice so the track can loop: at -50% the second copy
                sits exactly where the first began, which is the seam nobody sees.
                The clone is inert — tabIndex -1 and aria-hidden — so a drifting row
                doesn't hand the keyboard and screen readers six phantom buttons. */}
            <div className="suggestions">
              <div className="suggestions__track">
                {[...SUGGESTIONS, ...SUGGESTIONS].map((s, i) => {
                  const clone = i >= SUGGESTIONS.length;
                  return (
                    <button
                      key={i}
                      className="suggestion-pill"
                      onClick={() => void send(s.title)}
                      style={{ ["--card-accent" as string]: s.color }}
                      tabIndex={clone ? -1 : undefined}
                      aria-hidden={clone || undefined}
                    >
                      <span className="suggestion-pill__badge">{s.badge}</span>
                      {s.title}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {started && (
          <div className="chat" ref={feedRef}>
            {turns.map((turn, i) => (
              <Bubble key={i} turn={turn} />
            ))}
            {thinking && (
              <div className="chat__row chat__row--agent">
                <div className="chat__bubble chat__bubble--agent chat__bubble--thinking">
                  <span className="spinner" />
                  {THINKING_VERBS[verb]}…
                </div>
              </div>
            )}
            {ready && <SetupCard ready={ready} building={building} onBuild={build} />}
          </div>
        )}

        {suggest.length > 0 && !thinking && (
          <div className="chat__replies">
            {suggest.map((s) => (
              <button key={s} className="chat__reply" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* The composer and its tray are one object: the tray is positioned
            against this wrapper so it hangs off the card's bottom edge rather
            than floating somewhere near it. */}
        <div className="composer-wrap">
          <div className="composer">
            <textarea
              ref={inputRef}
              autoFocus
              placeholder={started ? "Reply…" : "I want to learn about…"}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
            />
            {/* Controls hang off the bottom of the field rather than sitting in a
                toolbar above it: what you're writing stays the top line of the
                box, and the row underneath is where you adjust how it's read. */}
            <div className="composer__row">
              {/* One control, not a label plus a gear. The pill states what will
                  run and opens the tray that changes it — a read-only chip beside
                  a button that opens the same thing was two affordances for one
                  job. */}
              <button
                className="composer__chip"
                aria-expanded={showOptions}
                onClick={() => setShowOptions((v) => !v)}
                title="Harness, model and effort"
                type="button"
              >
                <IconGear size={13} />
                <span>{active?.name ?? "No harness"}</span>
                <span className="composer__chip-sep">·</span>
                <span>{model || "default"}</span>
                {efforts.length > 0 && (
                  <>
                    <span className="composer__chip-sep">·</span>
                    <span>{effort || "default"}</span>
                  </>
                )}
              </button>
              <div className="composer__spacer" />
              <button
                className="btn btn--primary btn--round composer__send"
                onClick={() => void send(draft)}
                disabled={!draft.trim() || thinking || (noneAvailable && !started)}
                aria-label="Send"
              >
                {thinking ? "…" : "↑"}
              </button>
            </div>
          </div>

          {/* Always mounted, and revealed by growing its slot rather than by
              unmounting: a transition needs both ends of its travel to exist,
              and the height it has to travel isn't known until the harness
              picks how many options to show. The slot clips, so the panel reads
              as sliding out from behind the composer. */}
          <div className="tray-slot" data-open={showOptions || undefined}>
            <div className="tray">
              <div className="tray__group" role="group" aria-label="Author with">
                <button className="tray__opt" aria-pressed={driver === "auto"} onClick={() => setDriver("auto")} type="button">
                  Auto
                </button>
                {drivers.map((d) => (
                  <button
                    key={d.id}
                    className="tray__opt"
                    aria-pressed={driver === d.id}
                    disabled={!d.available || !d.supportsMcp}
                    onClick={() => setDriver(d.id)}
                    title={!d.available ? "Not installed" : !d.supportsMcp ? "No MCP support" : d.version}
                    type="button"
                  >
                    {d.name}
                  </button>
                ))}
              </div>

              <span className="eyebrow tray__label">Model</span>
              {/* Buttons only where the harness offers names to put on them. */}
              {models.length > 0 && (
                <div className="tray__group" role="group" aria-label="Model">
                  <button className="tray__opt" aria-pressed={!model} onClick={() => setModel("")} type="button">
                    Default
                  </button>
                  {models.map((m) => (
                    <button key={m} className="tray__opt" aria-pressed={model === m} onClick={() => setModel(m)} type="button">
                      {m}
                    </button>
                  ))}
                </div>
              )}
              {/* And the field stays, list or no list. What a CLI advertises is a
                  worked example rather than an enumeration — Claude Code names
                  three aliases in its help and accepts more — so the picker is a
                  shortcut to the common ones, never the set of what is legal. */}
              <input
                className="input tray__input"
                placeholder={models.length > 0 ? "Or type another" : "Default"}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />

              {efforts.length > 0 && (
                <>
                  <span className="eyebrow tray__label">Effort</span>
                  <div className="tray__group" role="group" aria-label="Effort">
                    <button className="tray__opt" aria-pressed={!effort} onClick={() => setEffort("")} type="button">
                      Default
                    </button>
                    {efforts.map((e) => (
                      <button key={e} className="tray__opt" aria-pressed={effort === e} onClick={() => setEffort(e)} type="button">
                        {e}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <p className="faint tray__note">
                Length, level and research are settled in the conversation.
              </p>
            </div>
          </div>
        </div>

        {showOptions && <div className="tray__scrim" onClick={() => setShowOptions(false)} aria-hidden="true" />}

        {noneAvailable && (
          <div className="notice" style={{ maxWidth: 640, marginTop: 16, textAlign: "left" }}>
            No agent CLI capable of authoring was found. Install Claude Code (<code>npm i -g @anthropic-ai/claude-code</code>) or
            another supported harness, then reload.
          </div>
        )}

        {error && (
          <div className="notice" style={{ maxWidth: 640, marginTop: 16, whiteSpace: "pre-line", textAlign: "left" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function Bubble({ turn }: { turn: ChatTurn }) {
  const agent = turn.role === "assistant";
  // The agent writes markdown without being asked to — it is a coding CLI —
  // so it gets the same renderer the lesson notes use rather than showing
  // asterisks. Learner turns stay plain: they typed literal text.
  return (
    <div className={`chat__row chat__row--${agent ? "agent" : "you"}`}>
      {agent ? (
        <div
          className="chat__bubble chat__bubble--agent article article--compact"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(turn.text) }}
        />
      ) : (
        <div className="chat__bubble chat__bubble--you">{turn.text}</div>
      )}
    </div>
  );
}

/** The handoff. Everything the agent settled on, and the only button that
 *  actually spends anything. */
function SetupCard({ ready, building, onBuild }: { ready: ReadyBuild; building: boolean; onBuild: () => void }) {
  const { buildConfig: bc } = ready;
  return (
    <div className="setup-card">
      <div className="eyebrow">Ready to build</div>
      <h3 className="setup-card__title">{ready.title}</h3>
      <dl className="setup-card__facts">
        <Fact label="Level" value={LEVEL_LABEL[ready.level] ?? ready.level} />
        <Fact label="Size" value={`up to ${bc.maxUnits} units × ${bc.maxLessonsPerUnit} lessons`} />
        <Fact label="Exercises" value={`up to ${bc.maxExercisesPerLesson} per lesson`} />
        <Fact label="Research" value={bc.skipResearch ? "Model knowledge only" : `Web, up to ${bc.maxSources} sources`} />
        <Fact label="Mode" value={CURATION_LABEL[ready.curation] ?? ready.curation} />
        {ready.focus ? <Fact label="Focus" value={ready.focus} /> : null}
      </dl>
      <button className="btn btn--primary btn--lg" onClick={onBuild} disabled={building}>
        {building ? "Starting…" : ready.curation === "manual" ? "Create outline" : "Build it"}
      </button>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="setup-card__fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
