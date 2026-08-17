import type { Answer, PlayableExercise } from "../../lib/types";

/**
 * What every exercise type receives from the player shell.
 *
 * Exercises don't call onSubmit themselves — the shell owns the "Check" button,
 * because Duolingo-style lessons always let the learner reconsider before
 * committing. Instead each exercise calls `registerAnswer` whenever its current
 * answer changes, handing the shell a getter it invokes at submit time. This
 * keeps every exercise a plain controlled component with no shared mutable state.
 */
export interface ExerciseProps<T extends PlayableExercise = PlayableExercise> {
  exercise: T;
  /** Set once the learner has submitted; drives every "locked in" visual state. */
  verdict: "correct" | "wrong" | null;
  /** Per-item correctness from the server, for exercises that mark up in place. */
  detail?: Array<{ label: string; correct: boolean }>;
  /**
   * The canonical answer, rendered as text in the verdict banner. multiple_choice
   * and true_false grade as a single pass/fail with no per-choice `detail` (there
   * is only one thing to grade), so those two use this instead to know which pill
   * to mark correct when the learner picked wrong.
   */
  correctAnswer?: string;
  /** Call with `null` when there is no valid answer yet (disables Check). */
  registerAnswer: (getAnswer: (() => Answer) | null) => void;
  disabled: boolean;
}

/** Deterministic shuffle keyed on a seed, so a re-render doesn't reshuffle mid-attempt. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const rng = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export const KEYS = "ABCDEFGH";
