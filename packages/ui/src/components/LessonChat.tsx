import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "../lib/api";
import { useEvents } from "../lib/useEvents";
import { renderMarkdown } from "../lib/markdown";
import { IconCross, IconSparkle } from "./Icons";
import type { ChatTurn } from "../lib/types";

/**
 * A tutor you can turn to without leaving the lesson.
 *
 * Docked rather than modal, and on the opposite edge from the source viewer, so
 * the thing being asked about stays on screen while you ask about it. Reading a
 * sentence, checking where it came from, and asking what it means are three
 * halves of the same act — putting any of them behind a dialog that hides the
 * other two is what makes people give up on a lesson instead of getting past it.
 *
 * The transcript lives here and is resent whole each turn: the server holds no
 * session, matching the setup interview, because no driver is guaranteed to
 * support resuming one. It is scoped to a lesson and starts empty when you open
 * a new one — the questions you had about photosynthesis are not context for a
 * lesson about batteries.
 */

/** Openers, shown only on an empty transcript. Phrased as the learner would. */
const STARTERS = ["Explain this more simply", "Why does that follow?", "Give me another example"];

interface Props {
  courseId: string;
  lessonId: string | null;
  lessonTitle: string;
}

export function LessonChat({ courseId, lessonId, lessonTitle }: Props) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * What the tutor is doing right now: `text` is the reply as it is written,
   * `reasoning` is the model's working-out on the way there.
   *
   * They are kept apart rather than concatenated because they are different
   * promises. The reply is what it stands behind; the reasoning is scaffolding
   * it may well discard, and showing them as one paragraph would present a
   * discarded thought as an answer.
   */
  const [live, setLive] = useState<{ text: string; reasoning: string }>({ text: "", reasoning: "" });
  const [askedAt, setAskedAt] = useState(0);
  /** Identifies this tab's in-flight turn on a broadcast event stream. */
  const turnRef = useRef<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A different lesson is a different conversation.
  useEffect(() => {
    setTurns([]);
    setError(null);
  }, [lessonId]);

  /*
   * The lesson is shifted by a class on <body> rather than by a prop, because
   * this drawer is portaled out of the player's subtree and the player also has
   * to answer to the source viewer on the other edge. One place decides how wide
   * each dock is; see the --dock-left/--dock-right pair in app.css.
   */
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("chat-open");
    return () => document.body.classList.remove("chat-open");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEvents((event) => {
    if (event.type !== "tutor.delta") return;
    // The bus is broadcast; another tab's conversation is not ours to render.
    if (event.turnId !== turnRef.current) return;
    setLive((prev) =>
      event.kind === "text"
        ? { ...prev, text: prev.text + event.text }
        : { ...prev, reasoning: prev.reasoning + event.text },
    );
  });

  // Pin to the newest message, including while a reply is still arriving.
  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [turns, thinking, live, open]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || thinking || !lessonId) return;

    const next: ChatTurn[] = [...turns, { role: "user", text: message }];
    const turnId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    turnRef.current = turnId;
    setTurns(next);
    setDraft("");
    setThinking(true);
    setAskedAt(Date.now());
    setLive({ text: "", reasoning: "" });
    setError(null);
    try {
      const reply = await api.lessonChat(courseId, lessonId, next, turnId);
      // The returned text is the authoritative one, not the streamed accumulation
      // — deltas are best-effort and a dropped one would otherwise leave a hole
      // in the middle of an answer that looks like the tutor's own writing.
      setTurns([...next, { role: "assistant", text: reply.text }]);
    } catch (err) {
      // The learner's question stays in the transcript so it can be retried
      // without retyping — losing what they wrote is the worse failure.
      setError(err instanceof ApiError ? err.message : "Couldn't reach the tutor.");
    } finally {
      turnRef.current = null;
      setThinking(false);
      setLive({ text: "", reasoning: "" });
    }
  };

  if (!lessonId) return null;

  return createPortal(
    <>
      {/* Rides the drawer's edge, so it reads as the handle of the thing it
          opens rather than a button that happens to live nearby. */}
      <button
        className="chat-tab"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close the tutor" : "Ask about this lesson"}
      >
        <IconSparkle size={15} />
        <span>Ask</span>
      </button>

      {open && (
        <aside className="chat-dock" aria-label="Ask about this lesson">
          <div className="chat-dock__bar">
            <div className="chat-dock__id">
              <span className="eyebrow">Tutor</span>
              <strong>{lessonTitle}</strong>
            </div>
            <button className="viewer__close" onClick={() => setOpen(false)} aria-label="Close">
              <IconCross size={16} />
            </button>
          </div>

          <div className="chat-dock__feed" ref={feedRef}>
            {turns.length === 0 && !thinking && (
              <p className="chat-dock__empty faint">
                Ask anything about this lesson. The tutor can see what you are reading and the sources behind it — it
                will not hand you an exercise answer, but it will help you get there.
              </p>
            )}

            <div className="chat">
              {turns.map((turn, i) => (
                <Bubble key={i} turn={turn} />
              ))}
              {thinking && <Live live={live} askedAt={askedAt} />}
            </div>

            {error && (
              <div className="notice" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
          </div>

          {turns.length === 0 && !thinking && (
            <div className="chat__replies chat-dock__starters">
              {STARTERS.map((s) => (
                <button key={s} className="chat__reply" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="chat-dock__composer">
            <div className="composer">
              <textarea
                ref={inputRef}
                autoFocus
                placeholder="Ask about this lesson…"
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
              <div className="chat-dock__send">
                <button
                  className="btn btn--sm"
                  onClick={() => void send(draft)}
                  disabled={thinking || draft.trim().length === 0}
                >
                  {thinking ? "…" : "Ask"}
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}
    </>,
    document.body,
  );
}

function Bubble({ turn }: { turn: ChatTurn }) {
  const agent = turn.role === "assistant";
  // Same split as the setup chat: the model writes markdown unprompted, the
  // learner types literal text.
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

/**
 * The tutor at work.
 *
 * Three states, in the order they arrive, because a spinner that sits there for
 * thirty seconds tells you only that something has not broken yet:
 *
 *   1. nothing yet          — a spinner, plus an elapsed count once the wait is
 *                             long enough to be worth reassuring someone about;
 *   2. reasoning only       — its working-out, marked as such and set quiet;
 *   3. the reply, streaming — the answer itself, appearing as it is written.
 *
 * Reasoning is dropped from view the moment real text starts, rather than
 * stacking above it: it was how the tutor got there, and once the answer is
 * arriving it is no longer the thing to read.
 *
 * A caveat measured rather than assumed: how much of state 2 and 3 you actually
 * see is up to the driver. The Claude CLI emits one text block per assistant
 * message, so a short answer arrives as a single chunk and this goes straight
 * from 1 to done — a 260-character reply measured here came as exactly one
 * delta. Reasoning appears only when the model emits thinking blocks. What is
 * deliberately NOT done is faking the difference by revealing a finished answer
 * letter by letter: that would dress a completed reply up as live work.
 */
function Live({ live, askedAt }: { live: { text: string; reasoning: string }; askedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (live.text) {
    return (
      <div className="chat__row chat__row--agent">
        <div
          className="chat__bubble chat__bubble--agent article article--compact chat__bubble--streaming"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(live.text) }}
        />
      </div>
    );
  }

  return (
    <div className="chat__row chat__row--agent">
      <div className="chat__bubble chat__bubble--agent chat__bubble--thinking">
        <span className="spinner" />
        {live.reasoning ? (
          <span className="chat__thought">
            {/* The tail of it. A thinking block runs to paragraphs and the panel
                is one column wide — the last thing it wrote is the part that
                says where it has got to. */}
            {live.reasoning.trim().split(/\n+/).slice(-1)[0]}
          </span>
        ) : (
          <>
            Thinking
            {/* A real elapsed count rather than a bare spinner. It is the only
                honest thing to show when the driver has sent nothing yet — but
                it is worth showing, because "still working after 20 seconds"
                and "wedged" look identical otherwise. */}
            {askedAt > 0 && now - askedAt > 2500 && (
              <span className="tabular"> {Math.round((now - askedAt) / 1000)}s</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
