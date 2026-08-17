import { useEffect, useState } from "react";
import { IconCheck, IconCross } from "../Icons";
import type { ExerciseProps } from "./shared";
import type { PlayableExercise } from "../../lib/types";

type TFExercise = Extract<PlayableExercise, { type: "true_false" }>;

export function TrueFalse({ exercise, verdict, correctAnswer, registerAnswer, disabled }: ExerciseProps<TFExercise>) {
  const [selected, setSelected] = useState<boolean | null>(null);

  useEffect(() => {
    setSelected(null);
    registerAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    registerAnswer(selected === null ? null : () => ({ kind: "boolean", value: selected }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const option = (value: boolean, label: string) => {
    const isSelected = selected === value;
    let choiceVerdict: "correct" | "wrong" | undefined;
    if (verdict) {
      if (isSelected) choiceVerdict = verdict;
      else if (verdict === "wrong" && label === correctAnswer) choiceVerdict = "correct";
    }
    return (
      <button
        className="choice"
        data-selected={isSelected || undefined}
        data-verdict={choiceVerdict}
        disabled={disabled || Boolean(verdict)}
        onClick={() => !verdict && setSelected(value)}
      >
        {label}
        {choiceVerdict && (choiceVerdict === "correct" ? <IconCheck size={18} /> : <IconCross size={18} />)}
      </button>
    );
  };

  return (
    <div className="tf" role="radiogroup" aria-label={exercise.prompt}>
      {option(true, "True")}
      {option(false, "False")}
    </div>
  );
}
