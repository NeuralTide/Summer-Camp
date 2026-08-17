import { useEffect, useState } from "react";
import type { ExerciseProps } from "./shared";
import type { PlayableExercise } from "../../lib/types";

type FlashcardExercise = Extract<PlayableExercise, { type: "flashcard" }>;
type Rating = "again" | "hard" | "good" | "easy";

const RATINGS: Array<{ value: Rating; label: string }> = [
  { value: "again", label: "Again" },
  { value: "hard", label: "Hard" },
  { value: "good", label: "Good" },
  { value: "easy", label: "Easy" },
];

/** Self-graded recall card: reveal, then judge yourself before Check submits it. */
export function Flashcard({ exercise, verdict, registerAnswer, disabled }: ExerciseProps<FlashcardExercise>) {
  const [revealed, setRevealed] = useState(false);
  const [rating, setRating] = useState<Rating | null>(null);

  useEffect(() => {
    setRevealed(false);
    setRating(null);
    registerAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    registerAnswer(rating ? () => ({ kind: "selfRated", value: rating }) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rating]);

  return (
    <div>
      <div className="flashcard" onClick={() => !revealed && setRevealed(true)} style={{ cursor: revealed ? "default" : "pointer" }}>
        <div>
          <div>{exercise.prompt}</div>
          {revealed ? (
            <div className="flashcard__back">{exercise.back}</div>
          ) : (
            <div className="faint" style={{ fontSize: 13, marginTop: 16 }}>
              Tap to reveal
            </div>
          )}
        </div>
      </div>

      {revealed && (
        <div className="self-rate">
          {RATINGS.map((r) => (
            <button
              key={r.value}
              className={`btn btn--sm ${rating === r.value ? "" : "btn--ghost"}`}
              disabled={disabled || Boolean(verdict)}
              onClick={() => setRating(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
