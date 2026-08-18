import { useEffect, useMemo, useRef, useState } from "react";
import { FieldPath } from "../components/FieldPath";
import { Meter } from "../components/Chrome";
import { IconBolt, IconBook, IconDumbbell, IconFlame, IconInfo, IconTrash, IconTrophy } from "../components/Icons";
import { OutlineEditor } from "../components/OutlineEditor";
import { api, ApiError } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";
import { useEvents } from "../lib/useEvents";
import type { AppEvent, BuildLogEntry, BuildPhase, CourseProgressView, CourseTree, Progress } from "../lib/types";

interface Props {
  courseId: string;
  progress: Progress;
  onStartLesson: (lessonId: string) => void;
  onStartPractice: () => void;
  onDeleted: () => void;
  onBack: () => void;
}

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface ViewState {
  course: CourseTree;
  view: CourseProgressView;
  jobId: string | null;
}

const PHASE_LABEL: Record<BuildPhase, string> = {
  starting: "Starting…",
  researching: "Researching the topic…",
  planning: "Planning the course…",
  authoring: "Writing lessons…",
  finishing: "Finishing up…",
  done: "Done",
  failed: "Failed",
};

type Tab = "path" | "about";

export function CourseScreen({ courseId, progress, onStartLesson, onStartPractice, onDeleted, onBack }: Props) {
  const [data, setData] = useState<ViewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<BuildLogEntry[]>([]);
  const [phase, setPhase] = useState<BuildPhase | null>(null);
  const [tab, setTab] = useState<Tab>("path");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const activeJobId = useRef<string | null>(null);

  const load = async () => {
    try {
      const res = await api.courseView(courseId);
      setData({ course: res.course, view: res.view, jobId: res.job?.id ?? null });
      if (res.job?.id && res.job.id !== activeJobId.current) {
        activeJobId.current = res.job.id;
        const full = await api.job(res.job.id);
        setLog(full.job.log);
        setPhase(full.job.phase);
      } else if (!res.job) {
        activeJobId.current = null;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load this course.");
    }
  };

  useEffect(() => {
    setData(null);
    setTab("path");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  useEvents((event: AppEvent) => {
    if (event.type === "course.updated" && event.course.id === courseId) void load();
    else if (event.type === "course.deleted" && event.courseId === courseId) onDeleted();
    else if (event.type === "build.progress" && event.courseId === courseId) {
      activeJobId.current = event.jobId;
      setPhase(event.phase);
    } else if (event.type === "build.log" && event.jobId === activeJobId.current) {
      setLog((prev) => [...prev.slice(-300), event.entry]);
    } else if (event.type === "build.finished" && event.courseId === courseId) {
      setPhase(event.ok ? "done" : "failed");
      void load();
    }
  });

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // Drives --head-fade on the course-head card (see .course-head in app.css):
  // 0 at rest, 1 once the card has scrolled its own height away, so it fades
  // and lifts in step with the gesture instead of on a threshold.
  //
  // Written to the node directly rather than held in state. This is a value
  // that changes every frame of a scroll, and putting it through React would
  // re-render the whole path — every unit, node and trail measurement — on
  // each one.
  const ready = data !== null;
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    // The card's own height, so there is no distance constant to keep in sync
    // with its padding. Read from getBoundingClientRect because that lands in
    // client pixels, the same space window.scrollY reports in — body carries
    // zoom: 1.5, so an offsetHeight reading would be off by exactly that.
    // Cleared on resize, where the header's flex-wrap can change it.
    let distance = 0;

    const apply = () => {
      frame = 0;
      const el = headRef.current;
      if (!el) return;
      if (!distance) distance = Math.max(1, el.getBoundingClientRect().height);
      el.style.setProperty("--head-fade", `${Math.min(1, window.scrollY / distance)}`);
      // Dropped once it is more gone than not, so a card you can barely see
      // can't swallow a click meant for the sign underneath it.
      el.style.pointerEvents = window.scrollY > distance / 2 ? "none" : "";
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onResize = () => {
      distance = 0;
      schedule();
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ready]);

  const resume = async (scope: "next" | "all") => {
    try {
      await api.resume(courseId, scope);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't resume authoring.");
    }
  };

  const remove = async () => {
    await api.deleteCourse(courseId);
    onDeleted();
  };

  if (error) {
    return (
      <div className="page">
        <div className="notice">{error}</div>
        <button className="btn" style={{ marginTop: 16 }} onClick={onBack}>
          Back to courses
        </button>
      </div>
    );
  }

  if (!data) return <div className="page" />;

  const { course, view } = data;
  const building = phase !== null && phase !== "done" && phase !== "failed";
  const unwritten = course.lessonCount - course.authoredCount;
  /**
   * Unwritten lessons the last build did not mean to leave behind.
   *
   * A course that writes just ahead of the reader always has unwritten lessons,
   * so the count alone says nothing. What made this worth distinguishing: a
   * build that lost its lessons to a usage limit still finished as "ready", and
   * the offer to write the rest was gated on a status it never had — leaving no
   * way to reach the missing lessons from the UI at all.
   */
  const lost = course.lastBuild ? Math.max(0, unwritten - course.lastBuild.deferred) : 0;
  const canWriteMore = unwritten > 0 && !building && course.status !== "planning" && course.status !== "reviewing";

  return (
    <div className="page course-page">
      <div className="course-layout">
        <div className="course-main">
          <div className="card course-head" ref={headRef}>
            <div className="course-head__title">
              <strong>{course.title}</strong>
              <span className="faint" style={{ fontSize: 12.5 }}>
                {course.level} · {course.authoredCount}/{course.lessonCount} lessons
              </span>
            </div>
            {/* Views only. Practice lives on the rail, which already has a card
                for it, and Settings is a permanent item in the sidebar — both
                sat here as a second way to reach somewhere you can already get
                to from the screen. */}
            <div className="course-head__tabs">
              <button className="tab-btn" aria-pressed={tab === "path"} onClick={() => setTab("path")}>
                <IconBook size={16} />
                Path
              </button>
              <button className="tab-btn" aria-pressed={tab === "about"} onClick={() => setTab("about")}>
                <IconInfo size={16} />
                About
              </button>
            </div>
          </div>

          <div className="stack">
            {building && (
              <div className="card">
                <div className="build__status">
                  <span className="spinner" />
                  <div>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>{PHASE_LABEL[phase!]}</div>
                    <div className="faint" style={{ fontSize: 13 }}>
                      {view.lessonsTotal > 0 ? `${course.authoredCount} of ${course.lessonCount} lessons written` : "Planning the structure…"}
                    </div>
                  </div>
                </div>
                <BuildLog log={log} logRef={logRef} />
              </div>
            )}

            {course.status === "failed" && !building && (
              <div className="notice">{course.error ?? "Something went wrong while building this course."}</div>
            )}

            {canWriteMore && (
              <div className={lost ? "notice" : "notice notice--info"} style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 220 }}>
                  {lost ? (
                    <>
                      <strong>This course didn’t finish building.</strong>{" "}
                      {course.authoredCount} of {course.lessonCount} lessons were written
                      {course.lastBuild?.detail ? ` — ${course.lastBuild.detail.replace(/\.$/, "")}` : ""}.
                    </>
                  ) : (
                    <>
                      {unwritten} lesson{unwritten === 1 ? "" : "s"} left to write. They’re written as you reach them — or start now.
                    </>
                  )}
                </span>
                {/* A unit at a time by default: writing everything at once is
                    what exhausted the agent in the first place. */}
                <button className="btn btn--sm" onClick={() => resume("next")}>
                  Write next unit
                </button>
                {unwritten > 1 && (
                  <button className="btn btn--sm btn--ghost" onClick={() => resume("all")}>
                    Write all {unwritten}
                  </button>
                )}
              </div>
            )}

            {tab === "path" &&
              (course.status === "reviewing" ? (
                <OutlineEditor course={course} />
              ) : (
                course.units.length > 0 && <FieldPath course={course} nodes={view.nodes} currentLessonId={view.nextLessonId} onOpen={onStartLesson} />
              ))}

            {tab === "about" && <AboutTab course={course} />}

            <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 20px" }}>
              {confirmDelete ? (
                <div className="stack" style={{ alignItems: "center", gap: 10 }}>
                  <span className="faint" style={{ fontSize: 13 }}>
                    Delete “{course.title}” and all progress on it?
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn--sm" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </button>
                    <button className="btn btn--wrong btn--sm" onClick={remove}>
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <button className="faint" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }} onClick={() => setConfirmDelete(true)}>
                  <IconTrash size={14} />
                  Delete course
                </button>
              )}
            </div>
          </div>
        </div>

        <CourseRail progress={progress} view={view} planning={course.status === "planning"} onStartPractice={onStartPractice} />
      </div>
    </div>
  );
}

function CourseRail({
  progress,
  view,
  planning,
  onStartPractice,
}: {
  progress: Progress;
  view: CourseProgressView;
  planning: boolean;
  onStartPractice: () => void;
}) {
  const todayXp = progress.dailyXp[todayKey()] ?? 0;

  return (
    <aside className="course-rail">
      <div className="card rail-card">
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          Today
        </div>
        <div className="rail-stats">
          <div className="rail-stat" style={{ color: progress.streak.current > 0 ? "var(--flame)" : "var(--ink-faint)" }}>
            <IconFlame size={17} />
            <strong className="tabular">{progress.streak.current}</strong>
            <span>streak</span>
          </div>
          <div className="rail-stat" style={{ color: "var(--gold)" }}>
            <IconBolt size={17} />
            <strong className="tabular">{progress.xp}</strong>
            <span>total XP</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <Meter value={todayXp} max={progress.dailyGoalXp} />
          <span className="tabular faint" style={{ fontSize: 12, flex: "none" }}>
            {todayXp}/{progress.dailyGoalXp}
          </span>
        </div>
      </div>

      {view.crownsPossible > 0 && (
        <div className="card rail-card">
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Mastery
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Meter value={view.percent} max={100} color="var(--gold)" />
            <span className="tabular faint" style={{ fontSize: 12, flex: "none" }}>
              {view.percent}%
            </span>
          </div>
          <div className="faint" style={{ fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
            <IconTrophy size={13} />
            {view.crownsEarned} / {view.crownsPossible} crowns
          </div>
        </div>
      )}

      {!planning && view.dueCount > 0 && (
        <div className="card rail-card">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Practice due
          </div>
          <p className="faint" style={{ fontSize: 13, margin: "0 0 12px" }}>
            {view.dueCount} lesson{view.dueCount === 1 ? "" : "s"} ready for review.
          </p>
          <button className="btn btn--primary btn--sm" style={{ width: "100%" }} onClick={onStartPractice}>
            <IconDumbbell size={15} />
            Practice now
          </button>
        </div>
      )}

    </aside>
  );
}

function AboutTab({ course }: { course: CourseTree }) {
  // Both fields are authored as markdown by the agent — the research notes tool
  // asks for it outright — so they get the same renderer the lesson notes use.
  const descriptionHtml = useMemo(() => renderMarkdown(course.description), [course.description]);
  const notesHtml = useMemo(() => renderMarkdown(course.researchNotes), [course.researchNotes]);

  return (
    <div className="stack">
      {/*
        Stated before the course describes itself, not tucked under it.

        While the only reader is the person who generated it this is obvious and
        redundant. It stops being either the moment a course is shared — and
        courses are single JSON files that are meant to be shared — so the app
        says it rather than relying on whoever passes the file on to remember.
      */}
      <div className="notice notice--info">
        <IconInfo size={16} />
        <span>
          Written by an AI agent and not reviewed by a subject expert. It is confident even when it is wrong — check anything
          you intend to rely on.
        </span>
      </div>

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          About this course
        </div>
        {course.description ? (
          <div className="article" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
        ) : (
          <p className="faint" style={{ margin: 0, lineHeight: 1.6 }}>
            No description yet.
          </p>
        )}
      </div>

      {course.researchNotes && (
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Research notes
          </div>
          <div className="article article--compact" dangerouslySetInnerHTML={{ __html: notesHtml }} />
        </div>
      )}

      {course.sources.length > 0 && (
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            Sources
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {course.sources.map((s, i) => (
              <div key={i} style={{ fontSize: 13.5 }}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
                    {s.title}
                  </a>
                ) : (
                  <strong>{s.title}</strong>
                )}
                {s.note && <div className="faint">{s.note}</div>}
              </div>
            ))}
          </div>
          <ArchiveSources courseId={course.id} sourceCount={course.sources.length} />
        </div>
      )}
    </div>
  );
}

/**
 * Fetch and keep a copy of every page this course cites.
 *
 * Offered here rather than done automatically at build time because it reaches
 * out to a dozen third-party sites, and because it is worth doing to courses
 * that were generated long before any of this existed — which is what makes it
 * a button rather than a build step. It spends no model usage at all.
 */
function ArchiveSources({ courseId, sourceCount }: { courseId: string; sourceCount: number }) {
  const [state, setState] = useState<"idle" | "working">("idle");
  const [result, setResult] = useState<{ archived: number; failed: Array<{ title: string; failure?: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loaded rather than assumed, so the button says what is actually on disk.
  useEffect(() => {
    let live = true;
    api
      .archivedCount(courseId)
      .then((res) => live && setResult((prev) => prev ?? { archived: res.archived, failed: [] }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [courseId]);

  const run = async () => {
    setState("working");
    setError(null);
    try {
      setResult(await api.archiveSources(courseId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't archive the sources.");
    } finally {
      setState("idle");
    }
  };

  const archived = result?.archived ?? 0;
  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--cream-deeper)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="faint" style={{ fontSize: 12.5, flex: 1, minWidth: 200 }}>
          {archived > 0
            ? `${archived} of ${sourceCount} sources archived — lesson paragraphs from these can be checked against them.`
            : "Keep a copy of these pages so lesson text can be traced back to them. Costs no model usage."}
        </span>
        <button className="btn btn--sm" onClick={run} disabled={state === "working"}>
          {state === "working" ? "Fetching…" : archived > 0 ? "Re-check" : "Archive sources"}
        </button>
      </div>
      {error && <div style={{ fontSize: 12.5, marginTop: 8, color: "var(--wrong)" }}>{error}</div>}
      {result && result.failed.length > 0 && (
        <div className="faint" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
          {result.failed.length} couldn’t be fetched:{" "}
          {result.failed.map((f) => `${f.title} (${f.failure ?? "unknown reason"})`).join("; ")}
        </div>
      )}
    </div>
  );
}

function BuildLog({ log, logRef }: { log: BuildLogEntry[]; logRef: React.RefObject<HTMLDivElement> }) {
  return (
    <div className="log" ref={logRef} style={{ marginTop: 16 }}>
      {log.length === 0 && <div className="faint">Waiting for the agent…</div>}
      {log.map((entry, i) => (
        <div key={i} className="log__row" data-level={entry.level}>
          {entry.worker !== undefined && <span className="log__worker">#{entry.worker}</span>}
          <span className="log__msg">{entry.message}</span>
        </div>
      ))}
    </div>
  );
}
