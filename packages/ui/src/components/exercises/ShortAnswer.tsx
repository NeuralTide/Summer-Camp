import { useEffect, useState } from "react";
import type { ExerciseProps } from "./shared";
import type { PlayableExercise } from "../../lib/types";

type ShortAnswerExercise = Extract<PlayableExercise, { type: "short_answer" }>;

export function ShortAnswer({ exercise, verdict, registerAnswer, disabled }: ExerciseProps<ShortAnswerExercise>) {
  const [text, setText] = useState("");

  useEffect(() => {
    setText("");
    registerAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  useEffect(() => {
    registerAnswer(wordCount >= exercise.minWords ? () => ({ kind: "text", value: text }) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <div>
      <textarea
        className="answer-box"
        value={text}
        disabled={disabled || Boolean(verdict)}
        placeholder="Write a sentence or two…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="wordcount faint" style={{ fontSize: 12.5 }}>
        {wordCount} / {exercise.minWords} words minimum
      </div>
    </div>
  );
}
