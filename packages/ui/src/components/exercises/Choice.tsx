import { useEffect, useState } from "react";
import { IconCheck, IconCross } from "../Icons";
import { KEYS } from "./shared";
import type { ExerciseProps } from "./shared";
import type { PlayableExercise } from "../../lib/types";

type ChoiceExercise = Extract<PlayableExercise, { type: "multiple_choice" }>;
type MultiExercise = Extract<PlayableExercise, { type: "multi_select" }>;

/** Single-answer multiple choice. */
export function MultipleChoice({ exercise, verdict, correctAnswer, registerAnswer, disabled }: ExerciseProps<ChoiceExercise>) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null);
    registerAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    registerAnswer(selected ? () => ({ kind: "choice", value: selected }) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Grading here is one pass/fail verdict for the whole exercise, not a per-choice
  // `detail` array — so the selected pill just takes that verdict directly, and
  // (only when wrong) the actually-correct choice is picked out by text match.
  const verdictFor = (choice: string): "correct" | "wrong" | undefined => {
    if (!verdict) return undefined;
    if (choice === selected) return verdict;
    if (verdict === "wrong" && choice === correctAnswer) return "correct";
    return undefined;
  };

  return (
    <div className="choices" role="radiogroup" aria-label={exercise.prompt}>
      {exercise.choices.map((choice, i) => {
        const isSelected = selected === choice;
        const choiceVerdict = verdictFor(choice);
        return (
          <button
            key={choice}
            className="choice"
            data-selected={isSelected || undefined}
            data-verdict={choiceVerdict}
            disabled={disabled || Boolean(verdict)}
            onClick={() => !verdict && setSelected(choice)}
          >
            <span className="choice__key">{KEYS[i]}</span>
            <span>{choice}</span>
            {choiceVerdict && (
              <span style={{ marginLeft: "auto" }}>{choiceVerdict === "correct" ? <IconCheck size={18} /> : <IconCross size={18} />}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-answer selection — toggle any number, then submit. */
export function MultiSelect({ exercise, verdict, detail, registerAnswer, disabled }: ExerciseProps<MultiExercise>) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set());
    registerAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    registerAnswer(selected.size > 0 ? () => ({ kind: "choices", values: [...selected] }) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const toggle = (choice: string) => {
    if (disabled || verdict) return;
    const next = new Set(selected);
    if (next.has(choice)) next.delete(choice);
    else next.add(choice);
    setSelected(next);
  };

  return (
    <div className="choices" role="group" aria-label={exercise.prompt}>
      {exercise.choices.map((choice, i) => {
        const isSelected = selected.has(choice);
        const correctness = detail?.find((d) => d.label === choice);
        const showVerdict = verdict && (isSelected || correctness?.correct);
        return (
          <button
            key={choice}
            className="choice"
            data-selected={isSelected || undefined}
            data-verdict={showVerdict ? (correctness?.correct ? "correct" : "wrong") : undefined}
            disabled={disabled || Boolean(verdict)}
            onClick={() => toggle(choice)}
          >
            <span className="choice__box">{isSelected && <IconCheck size={14} />}</span>
            <span>{choice}</span>
            <span style={{ marginLeft: "auto", color: "var(--ink-faint)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              {KEYS[i]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
