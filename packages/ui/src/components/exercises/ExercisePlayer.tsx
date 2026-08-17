import { Categorize } from "./Categorize";
import { MultipleChoice, MultiSelect } from "./Choice";
import { Flashcard } from "./Flashcard";
import { FillBlank } from "./FillBlank";
import { MatchPairs } from "./MatchPairs";
import { OrderSequence } from "./OrderSequence";
import type { ExerciseProps } from "./shared";
import { ShortAnswer } from "./ShortAnswer";
import { TrueFalse } from "./TrueFalse";
import type { Answer, PlayableExercise } from "../../lib/types";

/** Light-bulb hint icon, inline so this file has no extra import for one glyph. */
function HintIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18h6M10 22h4M12 2a6 6 0 0 0-4 10.5c.7.6 1 1.3 1 2.5h6c0-1.2.3-1.9 1-2.5A6 6 0 0 0 12 2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Props {
  exercise: PlayableExercise;
  verdict: "correct" | "wrong" | null;
  detail?: Array<{ label: string; correct: boolean }>;
  correctAnswer?: string;
  registerAnswer: (getAnswer: (() => Answer) | null) => void;
  disabled: boolean;
}

/**
 * Dispatches to the exercise type's own component. Every branch needs its own
 * generic instantiation of ExerciseProps because TypeScript can't narrow a
 * discriminated union through a dynamic dispatch table — this is the one place
 * that verbosity buys real type safety across nine very different UIs.
 */
export function ExercisePlayer({ exercise, verdict, detail, correctAnswer, registerAnswer, disabled }: Props) {
  return (
    <div>
      <div className="exercise__prompt">{exercise.prompt}</div>

      {exercise.hint && !verdict && (
        <div className="exercise__hint">
          <HintIcon />
          {exercise.hint}
        </div>
      )}

      {exercise.code && (
        <pre className="code-block">
          <code>{exercise.code.source}</code>
        </pre>
      )}

      <Body exercise={exercise} verdict={verdict} detail={detail} correctAnswer={correctAnswer} registerAnswer={registerAnswer} disabled={disabled} />
    </div>
  );
}

function Body(props: ExerciseProps) {
  switch (props.exercise.type) {
    case "multiple_choice":
      return <MultipleChoice {...(props as ExerciseProps<Extract<PlayableExercise, { type: "multiple_choice" }>>)} />;
    case "multi_select":
      return <MultiSelect {...(props as ExerciseProps<Extract<PlayableExercise, { type: "multi_select" }>>)} />;
    case "true_false":
      return <TrueFalse {...(props as ExerciseProps<Extract<PlayableExercise, { type: "true_false" }>>)} />;
    case "fill_blank":
      return <FillBlank {...(props as ExerciseProps<Extract<PlayableExercise, { type: "fill_blank" }>>)} />;
    case "match_pairs":
      return <MatchPairs {...(props as ExerciseProps<Extract<PlayableExercise, { type: "match_pairs" }>>)} />;
    case "order_sequence":
      return <OrderSequence {...(props as ExerciseProps<Extract<PlayableExercise, { type: "order_sequence" }>>)} />;
    case "categorize":
      return <Categorize {...(props as ExerciseProps<Extract<PlayableExercise, { type: "categorize" }>>)} />;
    case "short_answer":
      return <ShortAnswer {...(props as ExerciseProps<Extract<PlayableExercise, { type: "short_answer" }>>)} />;
    case "flashcard":
      return <Flashcard {...(props as ExerciseProps<Extract<PlayableExercise, { type: "flashcard" }>>)} />;
  }
}
