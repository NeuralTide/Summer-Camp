import { useEffect, useState } from "react";
import type { ExerciseProps } from "./shared";
import type { PlayableExercise } from "../../lib/types";

type CategorizeExercise = Extract<PlayableExercise, { type: "categorize" }>;

/** Tap an unsorted item, then tap the bucket it belongs in. */
export function Categorize({ exercise, verdict, detail, registerAnswer, disabled }: ExerciseProps<CategorizeExercise>) {
  const [placed, setPlaced] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setPlaced({});
    setSelected(null);
    registerAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    const complete = Object.keys(placed).length === exercise.items.length;
    registerAnswer(
      complete
        ? () => ({
            kind: "categorize",
            values: Object.entries(placed).map(([text, category]) => ({ text, category })),
          })
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);

  const place = (category: string) => {
    if (disabled || verdict || !selected) return;
    setPlaced((prev) => ({ ...prev, [selected]: category }));
    setSelected(null);
  };

  const unplace = (item: string) => {
    if (disabled || verdict) return;
    setPlaced((prev) => {
      const next = { ...prev };
      delete next[item];
      return next;
    });
  };

  const unsorted = exercise.items.filter((item) => !(item in placed));

  return (
    <div>
      <div className="bucket__items">
        {unsorted.map((item) => (
          <button
            key={item}
            className="chip"
            data-selected={selected === item || undefined}
            disabled={disabled || Boolean(verdict)}
            onClick={() => setSelected(item === selected ? null : item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="buckets" style={{ gridTemplateColumns: `repeat(${Math.min(exercise.categories.length, 2)}, 1fr)` }}>
        {exercise.categories.map((category) => (
          <div key={category} className="bucket" data-active={Boolean(selected) || undefined} onClick={() => place(category)}>
            <div className="bucket__name">{category}</div>
            <div className="bucket__items">
              {exercise.items
                .filter((item) => placed[item] === category)
                .map((item) => {
                  const isCorrect = detail?.find((d) => d.label === item)?.correct;
                  return (
                    <span
                      key={item}
                      className="chip"
                      data-selected="true"
                      data-verdict={verdict ? (isCorrect ? "correct" : "wrong") : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        unplace(item);
                      }}
                    >
                      {item}
                    </span>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
