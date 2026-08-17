import { useEffect, useMemo, useRef, useState } from "react";
import { ExercisePlayer } from "../components/exercises/ExercisePlayer";
import { IconCheck, IconCross, IconHeart } from "../components/Icons";
import { api, ApiError } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";
import { useEvents } from "../lib/useEvents";
import type { Answer, CompleteResponse, GradeResult, Session } from "../lib/types";

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
      <div className="player__top">
        <button className="btn btn--icon btn--ghost" onClick={onExit} aria-label="Close lesson">
          <IconCross size={18} />
        </button>

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

      <div className="player__body">
        <div className="player__inner">
          {onReadingPage ? (
            <div className="article">
              <h1>{session.lessonTitle}</h1>
              <div dangerouslySetInnerHTML={{ __html: notesHtml }} />
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
