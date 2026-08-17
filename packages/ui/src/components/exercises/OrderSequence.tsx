import { useEffect, useState } from "react";
import { IconChevronDown, IconChevronUp } from "../Icons";
import type { ExerciseProps } from "./shared";
import type { PlayableExercise } from "../../lib/types";

type OrderExercise = Extract<PlayableExercise, { type: "order_sequence" }>;

/** Reorder with up/down moves rather than drag-and-drop, so it works identically on touch. */
export function OrderSequence({ exercise, verdict, detail, registerAnswer, disabled }: ExerciseProps<OrderExercise>) {
  const [order, setOrder] = useState<string[]>(exercise.items);

  useEffect(() => {
    setOrder(exercise.items);
    registerAnswer(() => ({ kind: "order", values: exercise.items }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    registerAnswer(() => ({ kind: "order", values: order }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order]);

  const move = (index: number, dir: -1 | 1) => {
    if (disabled || verdict) return;
    const target = index + dir;
    if (target < 0 || target >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  return (
    <div className="order-list">
      {order.map((item, i) => {
        const isCorrect = detail?.[i]?.correct;
        return (
          <div
            key={item}
            className="order-item"
            data-verdict={verdict ? (isCorrect ? "correct" : "wrong") : undefined}
            style={
              verdict
                ? {
                    boxShadow: `inset 0 0 0 2px ${isCorrect ? "var(--correct)" : "var(--wrong)"}`,
                    background: isCorrect ? "var(--correct-soft)" : "var(--wrong-soft)",
                  }
                : undefined
            }
          >
            <span className="order-item__rank">{i + 1}</span>
            <span className="order-item__text">{item}</span>
            <span className="order-item__moves">
              <button className="icon-btn" disabled={disabled || Boolean(verdict) || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                <IconChevronUp />
              </button>
              <button
                className="icon-btn"
                disabled={disabled || Boolean(verdict) || i === order.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Move down"
              >
                <IconChevronDown />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
