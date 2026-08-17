import { useEffect, useState } from "react";
import type { ExerciseProps } from "./shared";
import type { PlayableExercise } from "../../lib/types";

type MatchExercise = Extract<PlayableExercise, { type: "match_pairs" }>;

/** Tap a left tile, then a right tile. A wrong pair shakes and un-selects; a right pair locks. */
export function MatchPairs({ exercise, verdict, detail, registerAnswer, disabled }: ExerciseProps<MatchExercise>) {
  const [matched, setMatched] = useState<Array<{ left: string; right: string }>>([]);
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [selectedRight, setSelectedRight] = useState<string | null>(null);

  useEffect(() => {
    setMatched([]);
    setSelectedLeft(null);
    setSelectedRight(null);
    registerAnswer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise.id]);

  useEffect(() => {
    // The learner may believe a pair is right when it isn't; submitting is what checks.
    registerAnswer(matched.length > 0 ? () => ({ kind: "pairs", values: matched }) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched]);

  const matchedLefts = new Set(matched.map((m) => m.left));
  const matchedRights = new Set(matched.map((m) => m.right));

  const tryMatch = (left: string, right: string) => {
    // We don't know the answer key client-side; a tentative match is recorded and
    // shown as "selected", with the true verdict only appearing after Check.
    setMatched((prev) => [...prev.filter((m) => m.left !== left && m.right !== right), { left, right }]);
    setSelectedLeft(null);
    setSelectedRight(null);
  };

  const clickLeft = (left: string) => {
    if (disabled || verdict || matchedLefts.has(left)) return;
    if (selectedRight) {
      tryMatch(left, selectedRight);
    } else {
      setSelectedLeft(left === selectedLeft ? null : left);
    }
  };

  const clickRight = (right: string) => {
    if (disabled || verdict || matchedRights.has(right)) return;
    if (selectedLeft) {
      tryMatch(selectedLeft, right);
    } else {
      setSelectedRight(right === selectedRight ? null : right);
    }
  };

  const unmatch = (left: string) => {
    if (disabled || verdict) return;
    setMatched((prev) => prev.filter((m) => m.left !== left));
  };

  // Grading is per-pair (see core's match_pairs detail, keyed "left → right"), so
  // the blanket exercise verdict is not enough to colour each tile correctly.
  const verdictFor = (left: string): "correct" | "wrong" | undefined => {
    if (!verdict) return undefined;
    const right = matched.find((m) => m.left === left)?.right;
    if (!right) return undefined;
    const entry = detail?.find((d) => d.label === `${left} → ${right}`);
    return entry ? (entry.correct ? "correct" : "wrong") : verdict;
  };

  return (
    <div className="pairs">
      <div className="pairs__col">
        {exercise.lefts.map((left) => {
          const pairedWith = matched.find((m) => m.left === left)?.right;
          return (
            <button
              key={left}
              className="pair-tile"
              data-selected={selectedLeft === left || undefined}
              data-matched={matchedLefts.has(left) || undefined}
              data-verdict={verdictFor(left)}
              disabled={disabled || Boolean(verdict)}
              onClick={() => (pairedWith && !verdict ? unmatch(left) : clickLeft(left))}
              title={pairedWith ? `Paired with “${pairedWith}” — tap to change` : undefined}
            >
              {left}
            </button>
          );
        })}
      </div>
      <div className="pairs__col">
        {exercise.rights.map((right) => (
          <button
            key={right}
            className="pair-tile"
            data-selected={selectedRight === right || undefined}
            data-matched={matchedRights.has(right) || undefined}
            data-verdict={(() => {
              const left = matched.find((m) => m.right === right)?.left;
              return left ? verdictFor(left) : undefined;
            })()}
            disabled={disabled || Boolean(verdict)}
            onClick={() => clickRight(right)}
          >
            {right}
          </button>
        ))}
      </div>
    </div>
  );
}
