/**
 * SM-2 spaced repetition, adapted for graded (0..1) rather than 0..5 answers.
 *
 * One card per exercise. Cards are created lazily the first time an exercise is
 * answered, so planning a course costs nothing until the learner actually studies.
 */

export interface SrsCard {
  exerciseId: string;
  courseId: string;
  lessonId: string;
  /** Ease factor. Higher = longer gaps. SM-2 floors this at 1.3. */
  ease: number;
  /** Days until the next review. */
  intervalDays: number;
  /** Consecutive successful reviews. Resets to 0 on a lapse. */
  streak: number;
  /** Total times reviewed. */
  reps: number;
  /** Total times failed. */
  lapses: number;
  dueAt: string;
  lastReviewedAt: string;
  /** Rolling average score, used for weak-area reporting. */
  avgScore: number;
}

export const MIN_EASE = 1.3;
const DAY_MS = 86_400_000;

export function newCard(exerciseId: string, courseId: string, lessonId: string, now = new Date()): SrsCard {
  return {
    exerciseId,
    courseId,
    lessonId,
    ease: 2.5,
    intervalDays: 0,
    streak: 0,
    reps: 0,
    lapses: 0,
    dueAt: now.toISOString(),
    lastReviewedAt: now.toISOString(),
    avgScore: 0,
  };
}

/** Map a 0..1 grade onto SM-2's 0..5 quality scale. */
function quality(score: number): number {
  if (score >= 0.99) return 5;
  if (score >= 0.85) return 4;
  if (score >= 0.6) return 3;
  if (score >= 0.35) return 2;
  if (score > 0) return 1;
  return 0;
}

export function reviewCard(card: SrsCard, score: number, now = new Date()): SrsCard {
  const q = quality(score);
  const passed = q >= 3;

  let { ease, intervalDays, streak, lapses } = card;

  // Standard SM-2 ease update; a perfect answer nudges ease up, a poor one down.
  ease = Math.max(MIN_EASE, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  if (!passed) {
    lapses += 1;
    streak = 0;
    // Lapsed cards come back within the same session-ish window, not tomorrow.
    intervalDays = q === 0 ? 0 : 0.02;
  } else {
    streak += 1;
    if (streak === 1) intervalDays = 1;
    else if (streak === 2) intervalDays = 3;
    else intervalDays = Math.min(365, Math.round(intervalDays * ease * 10) / 10);
    if (q === 5 && streak > 2) intervalDays = Math.min(365, Math.round(intervalDays * 1.15 * 10) / 10);
  }

  const reps = card.reps + 1;
  return {
    ...card,
    ease: Math.round(ease * 1000) / 1000,
    intervalDays,
    streak,
    reps,
    lapses,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
    lastReviewedAt: now.toISOString(),
    avgScore: Math.round(((card.avgScore * card.reps + score) / reps) * 1000) / 1000,
  };
}

export function isDue(card: SrsCard, now = new Date()): boolean {
  return new Date(card.dueAt).getTime() <= now.getTime();
}

/**
 * Cards worth reviewing now, worst-remembered first so a short session covers the
 * shakiest material rather than whatever happens to be alphabetically first.
 */
export function dueCards(cards: SrsCard[], now = new Date(), limit = Infinity): SrsCard[] {
  return cards
    .filter((c) => isDue(c, now))
    .sort((a, b) => {
      const overdueA = now.getTime() - new Date(a.dueAt).getTime();
      const overdueB = now.getTime() - new Date(b.dueAt).getTime();
      const weightA = overdueA * (1.3 - a.avgScore);
      const weightB = overdueB * (1.3 - b.avgScore);
      return weightB - weightA;
    })
    .slice(0, limit);
}

/** Mastery of a card, 0..1, blending recall streak with accuracy. */
export function cardStrength(card: SrsCard, now = new Date()): number {
  if (card.reps === 0) return 0;
  const intervalScore = Math.min(1, card.intervalDays / 21);
  const decay = isDue(card, now) ? 0.7 : 1;
  return Math.round(Math.min(1, (intervalScore * 0.6 + card.avgScore * 0.4) * decay) * 100) / 100;
}
