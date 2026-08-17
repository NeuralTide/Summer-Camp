import { useEffect, useMemo, useRef, useState } from "react";
import { seededShuffle } from "./shared";
import type { ExerciseProps } from "./shared";
import type { PlayableExercise } from "../../lib/types";

type FillBlankExercise = Extract<PlayableExercise, { type: "fill_blank" }>;

const MARKER = "___";

/**
 * Renders as free-typed inputs when there's no word bank, or as tap-to-fill slots
 * when there is — mirroring which affordance the author actually gave the learner.
 */
export function FillBlank({ exercise, verdict, detail, registerAnswer, disabled }: ExerciseProps<FillBlankExercise>) {
  const segments = useMemo(() => exercise.prompt.split(MARKER), [exercise.prompt]);
  const [values, setValues] = useState<string[]>(() => Array(exercise.blankCount).fill(""));
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    setValues(Array(exercise.blankCount).fill(""));
    registerAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    const complete = values.every((v) => v.trim().length > 0);
    registerAnswer(complete ? () => ({ kind: "blanks", values }) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const setAt = (index: number, value: string) => {
    setValues((prev) => prev.map((v, i) => (i === index ? value : v)));
  };

  if (exercise.wordBank) {
    return (
      <TileFill
        segments={segments}
        wordBank={exercise.wordBank}
        exerciseId={exercise.id}
        values={values}
        verdict={verdict}
        detail={detail}
        disabled={disabled}
        onChange={setAt}
      />
    );
  }

  return (
    <div className="blank-text">
      {segments.map((segment, i) => (
        <span key={i}>
          {segment}
          {i < segments.length - 1 && (
            <input
              ref={(el) => {
                inputsRef.current[i] = el;
              }}
              className="blank-input"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={values[i] ?? ""}
              disabled={disabled || Boolean(verdict)}
              data-verdict={verdict ? (detail?.[i]?.correct ? "correct" : "wrong") : undefined}
              placeholder="…"
              style={{ width: `${Math.max(6, (values[i]?.length ?? 0) + 2)}ch` }}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") inputsRef.current[i + 1]?.focus();
              }}
            />
          )}
        </span>
      ))}
      {verdict && detail?.some((d) => !d.correct) && (
        <div className="faint" style={{ fontSize: 13, marginTop: 8 }}>
          Correct answer{detail.length > 1 ? "s" : ""}: {detail.map((d) => d.label).join(", ")}
        </div>
      )}
    </div>
  );
}

function TileFill({
  segments,
  wordBank,
  exerciseId,
  values,
  verdict,
  detail,
  disabled,
  onChange,
}: {
  segments: string[];
  wordBank: string[];
  exerciseId: string;
  values: string[];
  verdict: "correct" | "wrong" | null;
  detail?: Array<{ label: string; correct: boolean }>;
  disabled: boolean;
  onChange: (index: number, value: string) => void;
}) {
  const tiles = useMemo(() => seededShuffle(wordBank, exerciseId), [wordBank, exerciseId]);
  const [activeSlot, setActiveSlot] = useState(0);

  const used = new Set(values.filter(Boolean));

  const place = (word: string) => {
    if (disabled || verdict) return;
    const target = values.findIndex((v, i) => !v && i === activeSlot) >= 0 ? activeSlot : values.findIndex((v) => !v);
    if (target < 0) return;
    onChange(target, word);
    const next = values.findIndex((v, i) => i > target && !v);
    setActiveSlot(next >= 0 ? next : target);
  };

  const clear = (index: number) => {
    if (disabled || verdict) return;
    onChange(index, "");
    setActiveSlot(index);
  };

  return (
    <div>
      <div className="blank-text">
        {segments.map((segment, i) => (
          <span key={i}>
            {segment}
            {i < segments.length - 1 && (
              <span
                className="blank-slot"
                data-filled={Boolean(values[i]) || undefined}
                data-verdict={verdict ? (detail?.[i]?.correct ? "correct" : "wrong") : undefined}
                onClick={() => (values[i] ? clear(i) : setActiveSlot(i))}
              >
                {values[i] || "···"}
              </span>
            )}
          </span>
        ))}
      </div>
      <div className="word-bank">
        {tiles.map((word) => (
          <button
            key={word}
            className="tile"
            data-used={used.has(word) || undefined}
            disabled={disabled || Boolean(verdict) || used.has(word)}
            onClick={() => place(word)}
          >
            {word}
          </button>
        ))}
      </div>
    </div>
  );
}
