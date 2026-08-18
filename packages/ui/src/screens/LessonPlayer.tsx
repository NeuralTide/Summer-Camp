import { useEffect, useMemo, useRef, useState } from "react";
import { ExercisePlayer } from "../components/exercises/ExercisePlayer";
import { IconCheck, IconCross, IconHeart, IconInfo } from "../components/Icons";
import { LessonChat } from "../components/LessonChat";
import { SourcedNotes } from "../components/SourcedNotes";
import { api, ApiError } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";
import { useEvents } from "../lib/useEvents";
import type { Answer, CompleteResponse, GradeResult, ReviseResult, Session } from "../lib/types";

interface Props {
  session: Session;
  hearts: number;
  unlimitedHearts: boolean;
  onExit: () => void;
  onFinish: (result: CompleteResponse) => void;
}

/**
 * Owns one lesson attempt end to end: the reading page, the exercise loop, heart
 * spending, and the verdict banner. The server is the source of truth for scoring
 * and hearts — this component reflects what it returns rather than computing its
 * own verdicts, so the two can never drift apart.
 *
 * Steps are indexed uniformly: step 0 is the reading page (if the lesson has
 * notes), steps after that are exercises — matching the single strip of progress
 * pills across the top.
 */
export function LessonPlayer({ session, hearts: initialHearts, unlimitedHearts, onExit, onFinish }: Props) {
  const hasNotes = session.notes.trim().length > 0;
  const steps = hasNotes ? session.exercises.length + 1 : session.exercises.length;

  const [step, setStep] = useState(0);
  const [hearts, setHearts] = useState(initialHearts);
  const [verdict, setVerdict] = useState<"correct" | "wrong" | null>(null);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState(false);
  const [outOfHearts, setOutOfHearts] = useState(false);

  const answerGetter = useRef<(() => Answer) | null>(null);
  const [hasAnswer, setHasAnswer] = useState(false);
  const [reporting, setReporting] = useState(false);

  const exerciseIndex = hasNotes ? step - 1 : step;
  const onReadingPage = hasNotes && step === 0;
  const exercise = onReadingPage ? null : session.exercises[exerciseIndex];
  const notesHtml = useMemo(() => renderMarkdown(session.notes), [session.notes]);

  useEvents((event) => {
    if (event.type !== "grade.updated" || !exercise) return;
    if (event.exerciseId !== exercise.id) return;
    setGrading(false);
    setGrade((prev) => (prev ? { ...prev, correct: event.correct, score: event.score, feedback: event.feedback, provisional: false } : prev));
    setVerdict(event.correct ? "correct" : "wrong");
  });

  const registerAnswer = (getter: (() => Answer) | null) => {
    answerGetter.current = getter;
    setHasAnswer(getter !== null);
  };

  const check = async () => {
    if (!exercise || !answerGetter.current || submitting) return;
    const answer = answerGetter.current();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.answer(session.id, exercise.id, answer);
      setVerdict(res.result.correct ? "correct" : "wrong");
      setGrade(res.result);
      setExplanation(res.explanation);
      setGrading(Boolean(res.result.provisional));
      setHearts(res.hearts);
      if (res.outOfHearts) setOutOfHearts(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit that answer. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const advance = async () => {
    setVerdict(null);
    setGrade(null);
    setExplanation(null);
    setGrading(false);
    registerAnswer(null);

    if (step + 1 < steps) {
      setStep(step + 1);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.complete(session.id);
      onFinish(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't finish the lesson. Check your connection and try again.");
      setSubmitting(false);
    }
  };

  const primaryLabel = onReadingPage ? "Next" : verdict ? "Next" : "Check";
  const primaryAction = onReadingPage || verdict ? advance : check;
  const primaryDisabled = onReadingPage ? false : verdict ? submitting : !hasAnswer || submitting;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "TEXTAREA" && !verdict && !onReadingPage) return;
      e.preventDefault();
      if (!primaryDisabled) void primaryAction();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, verdict, hasAnswer, primaryDisabled]);

  if (outOfHearts) {
    return <OutOfHearts courseColor={session.courseColor} onExit={onExit} />;
  }

  return (
    <div className="player">
      {/* Outside .player__body so it survives moving between the reading page
          and the exercises — a question asked on step 1 is still worth having
          an answer to on step 4. */}
      <LessonChat courseId={session.courseId} lessonId={session.lessonId} lessonTitle={session.lessonTitle} />

      <div className="player__top">
        <button className="btn btn--icon btn--ghost" onClick={onExit} aria-label="Close lesson">
          <IconCross size={18} />
        </button>

        {/* Reachable from anywhere in the lesson, because you notice an error
            while reading the notes as often as while answering. Practice
            sessions draw from many lessons at once and have no single lesson to
            report, so it is hidden there. */}
        {session.lessonId && (
          <button
            className="btn btn--icon btn--ghost"
            onClick={() => setReporting(true)}
            title="Report a problem with this lesson"
            aria-label="Report a problem with this lesson"
          >
            <IconInfo size={17} />
          </button>
        )}

        <div className="progress-pills">
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className="progress-pill" data-state={i < step ? "done" : i === step ? "current" : undefined} />
          ))}
        </div>

        {unlimitedHearts ? (
          <div style={{ width: 38 }} />
        ) : (
          <div className="btn btn--icon btn--ghost" style={{ color: "var(--flame)" }}>
            <IconHeart size={15} />
            <span className="tabular" style={{ marginLeft: 4, fontSize: 13 }}>
              {hearts}
            </span>
          </div>
        )}
      </div>

      {reporting && session.lessonId && (
        <ReportDialog
          courseId={session.courseId}
          lessonId={session.lessonId}
          lessonTitle={session.lessonTitle}
          onClose={() => setReporting(false)}
        />
      )}

      <div className="player__body">
        <div className="player__inner">
          {onReadingPage ? (
            <div className="article">
              <h1>{session.lessonTitle}</h1>
              <SourcedNotes courseId={session.courseId} lessonId={session.lessonId} html={notesHtml} />
            </div>
          ) : exercise ? (
            <ExercisePlayer
              key={exercise.id}
              exercise={exercise}
              verdict={verdict}
              detail={grade?.detail}
              correctAnswer={grade?.correctAnswer}
              registerAnswer={registerAnswer}
              disabled={submitting}
            />
          ) : null}

          {error && <div className="notice" style={{ marginTop: 18 }}>{error}</div>}
        </div>
      </div>

      {verdict && grade && (
        <div className="verdict" data-verdict={verdict}>
          <div className="verdict__card">
            <div className="verdict__title">
              {verdict === "correct" ? <IconCheck size={17} /> : <IconCross size={17} />}
              {verdict === "correct" ? "Correct!" : "Not quite"}
            </div>
            <div className="verdict__detail">
              {grade.feedback}
              {!grade.correct && grade.correctAnswer && (
                <>
                  {" "}
                  <span className="verdict__answer">Answer: {grade.correctAnswer}</span>
                </>
              )}
            </div>
            {explanation && <div className="verdict__detail" style={{ marginTop: 4 }}>{explanation}</div>}
            {grading && <div className="verdict__grading">Double-checking your answer…</div>}
          </div>
        </div>
      )}

      <div className="player__nav">
        <div className="player__nav-inner">
          <button className="btn btn--flat" disabled>
            Back
          </button>
          <button
            className={`btn btn--primary ${verdict ? (verdict === "correct" ? "btn--correct" : "btn--wrong") : ""}`}
            disabled={primaryDisabled}
            onClick={primaryAction}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutOfHearts({ courseColor, onExit }: { courseColor: string; onExit: () => void }) {
  return (
    <div className="results">
      <div className="results__inner">
        <div style={{ fontSize: 60 }}>💔</div>
        <h1 className="results__title">Out of hearts</h1>
        <p className="muted">
          You've used all your hearts. They refill over time, or come back once you review something in Practice.
        </p>
        <button className="btn btn--primary btn--lg" style={{ marginTop: 22, background: courseColor }} onClick={onExit}>
          Back to course
        </button>
      </div>
    </div>
  );
}

/**
 * "This looks wrong."
 *
 * Deliberately asks for the objection in words rather than offering a set of
 * canned reasons. The agent has to re-derive the point to check it, and
 * "factually incorrect" gives it nothing to check — where "attention is masked
 * in GPT, so a token can't see future tokens" is a claim it can go and verify.
 *
 * The wait is a real agent turn, up to a couple of minutes, so this holds the
 * dialog open with a spinner instead of closing optimistically: there is a
 * verdict coming and it is the reason the learner asked.
 */
function ReportDialog({
  courseId,
  lessonId,
  lessonTitle,
  onClose,
}: {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  onClose: () => void;
}) {
  const [objection, setObjection] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReviseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (objection.trim().length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await api.reportLesson(courseId, lessonId, objection.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't check this lesson.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="report-scrim" onClick={busy ? undefined : onClose}>
      <div className="card report-card" onClick={(e) => e.stopPropagation()}>
        {result ? (
          <>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              {result.outcome === "corrected" ? "Lesson corrected" : result.outcome === "unchanged" ? "Lesson stands" : "Couldn't check it"}
            </div>
            <p style={{ margin: "0 0 14px", lineHeight: 1.6 }}>{result.message}</p>
            {result.cardsReset > 0 && (
              <p className="faint" style={{ fontSize: 12.5, margin: "0 0 14px" }}>
                {result.cardsReset} exercise{result.cardsReset === 1 ? " was" : "s were"} rewritten, so{" "}
                {result.cardsReset === 1 ? "its" : "their"} review history was cleared —{" "}
                {result.cardsReset === 1 ? "it" : "they"} will come back around as new.
              </p>
            )}
            <button className="btn btn--primary" style={{ width: "100%" }} onClick={onClose}>
              {result.outcome === "corrected" ? "Reload the lesson to see it" : "Back to the lesson"}
            </button>
          </>
        ) : (
          <>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Report a problem
            </div>
            <p className="faint" style={{ fontSize: 13, margin: "0 0 12px", lineHeight: 1.55 }}>
              {lessonTitle}
            </p>
            <textarea
              className="textarea"
              autoFocus
              placeholder="What's wrong? Be specific — the agent has to check the claim, so name it."
              value={objection}
              onChange={(e) => setObjection(e.target.value)}
              disabled={busy}
            />
            {error && (
              <div className="notice" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
            <p className="faint" style={{ fontSize: 12, margin: "12px 0 14px", lineHeight: 1.5 }}>
              The agent re-checks the lesson and rewrites it only if you're right. It can decide you aren't.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn--flat" style={{ flex: "none" }} onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                className="btn btn--primary"
                style={{ flex: 1 }}
                onClick={() => void submit()}
                disabled={busy || objection.trim().length < 4}
              >
                {busy ? (
                  <>
                    <span className="spinner" />
                    Checking…
                  </>
                ) : (
                  "Check this lesson"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
