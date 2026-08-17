import { cardStrength, type SrsCard } from "./srs.js";
import { lessonSequence, type Course, type Lesson } from "./schema.js";

/** Gamification constants, kept together so the feel of the app is tunable in one place. */
export const RULES = {
  maxHearts: 5,
  /** One heart back every 25 minutes. */
  heartRegenMs: 25 * 60 * 1000,
  xpPerCorrect: 10,
  xpLessonComplete: 20,
  xpPerfectBonus: 15,
  xpPerReview: 5,
  defaultDailyGoal: 50,
  /** Crowns per lesson: 0 new → 1 learned → 2 practised → 3 mastered. */
  maxCrowns: 3,
  /** A lesson must be answered at least this well to count as complete. */
  passThreshold: 0.6,
} as const;

export interface LessonProgress {
  lessonId: string;
  courseId: string;
  completions: number;
  crowns: number;
  bestScore: number;
  lastScore: number;
  lastCompletedAt?: string;
}

export interface StreakState {
  current: number;
  longest: number;
  /** Local calendar day, YYYY-MM-DD. */
  lastStudyDay: string | null;
}

export interface Progress {
  xp: number;
  hearts: number;
  heartsUpdatedAt: string;
  streak: StreakState;
  dailyGoalXp: number;
  /** XP earned per local calendar day, for the streak calendar. */
  dailyXp: Record<string, number>;
  lessons: Record<string, LessonProgress>;
  cards: Record<string, SrsCard>;
  courses: Record<string, { startedAt: string; lastStudiedAt: string }>;
}

export function emptyProgress(now = new Date()): Progress {
  return {
    xp: 0,
    hearts: RULES.maxHearts,
    heartsUpdatedAt: now.toISOString(),
    streak: { current: 0, longest: 0, lastStudyDay: null },
    dailyGoalXp: RULES.defaultDailyGoal,
    dailyXp: {},
    lessons: {},
    cards: {},
    courses: {},
  };
}

/** Local calendar day key. Streaks follow the learner's wall clock, not UTC. */
export function dayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

/**
 * Hearts regenerate on wall-clock time rather than on a timer, so they refill
 * correctly across restarts. Call before reading `hearts`.
 */
export function settleHearts(progress: Progress, now = new Date()): Progress {
  if (progress.hearts >= RULES.maxHearts) {
    return { ...progress, heartsUpdatedAt: now.toISOString() };
  }
  const elapsed = now.getTime() - new Date(progress.heartsUpdatedAt).getTime();
  const regained = Math.floor(elapsed / RULES.heartRegenMs);
  if (regained <= 0) return progress;
  const hearts = Math.min(RULES.maxHearts, progress.hearts + regained);
  // Keep the remainder so partial progress toward the next heart isn't lost.
  const consumed = (hearts - progress.hearts) * RULES.heartRegenMs;
  return {
    ...progress,
    hearts,
    heartsUpdatedAt: new Date(new Date(progress.heartsUpdatedAt).getTime() + consumed).toISOString(),
  };
}

/** Milliseconds until the next heart, or null when full. */
export function msToNextHeart(progress: Progress, now = new Date()): number | null {
  if (progress.hearts >= RULES.maxHearts) return null;
  const elapsed = now.getTime() - new Date(progress.heartsUpdatedAt).getTime();
  return Math.max(0, RULES.heartRegenMs - (elapsed % RULES.heartRegenMs));
}

export function awardXp(progress: Progress, amount: number, now = new Date()): Progress {
  if (amount <= 0) return progress;
  const day = dayKey(now);
  const dailyXp = { ...progress.dailyXp, [day]: (progress.dailyXp[day] ?? 0) + amount };
  return { ...progress, xp: progress.xp + amount, dailyXp };
}

/**
 * Advance the streak for today. Idempotent: studying twice in one day does not
 * double-count, and a gap of more than one day resets to 1 rather than 0 — the
 * session happening right now is itself day one of the new streak.
 */
export function touchStreak(progress: Progress, now = new Date()): Progress {
  const today = dayKey(now);
  const last = progress.streak.lastStudyDay;
  if (last === today) return progress;

  const gap = last ? daysBetween(last, today) : Infinity;
  const current = gap === 1 ? progress.streak.current + 1 : 1;
  return {
    ...progress,
    streak: {
      current,
      longest: Math.max(progress.streak.longest, current),
      lastStudyDay: today,
    },
  };
}

/** A streak survives until the end of the day *after* the last study day. */
export function streakIsAlive(progress: Progress, now = new Date()): boolean {
  const last = progress.streak.lastStudyDay;
  if (!last) return false;
  return daysBetween(last, dayKey(now)) <= 1;
}

export function loseHeart(progress: Progress, now = new Date()): Progress {
  const settled = settleHearts(progress, now);
  if (settled.hearts <= 0) return settled;
  return {
    ...settled,
    hearts: settled.hearts - 1,
    // Start the regen clock from the moment the heart was lost.
    heartsUpdatedAt: settled.hearts === RULES.maxHearts ? now.toISOString() : settled.heartsUpdatedAt,
  };
}

export function refillHearts(progress: Progress, now = new Date()): Progress {
  return { ...progress, hearts: RULES.maxHearts, heartsUpdatedAt: now.toISOString() };
}

/* ------------------------------------------------------------------ */
/* Derived views                                                       */
/* ------------------------------------------------------------------ */

export type NodeState = "locked" | "available" | "in_progress" | "complete" | "mastered";

export interface LessonNode {
  lessonId: string;
  unitId: string;
  title: string;
  kind: Lesson["kind"];
  authored: boolean;
  exerciseCount: number;
  state: NodeState;
  crowns: number;
  bestScore: number;
  unitIndex: number;
  lessonIndex: number;
  globalIndex: number;
}

export interface CourseProgressView {
  courseId: string;
  nodes: LessonNode[];
  unitsComplete: number;
  lessonsComplete: number;
  lessonsTotal: number;
  crownsEarned: number;
  crownsPossible: number;
  percent: number;
  /** The next lesson to open when the learner taps "Continue". */
  nextLessonId: string | null;
  dueCount: number;
}

/**
 * Lessons unlock strictly in order, gated on the previous lesson being passed.
 * Unauthored stubs are always locked — there is nothing to play yet.
 */
export function courseProgress(course: Course, progress: Progress, now = new Date()): CourseProgressView {
  const seq = lessonSequence(course);
  const nodes: LessonNode[] = [];
  let previousPassed = true;
  let nextLessonId: string | null = null;

  for (const entry of seq) {
    const lp = progress.lessons[entry.lesson.id];
    const completions = lp?.completions ?? 0;
    const crowns = lp?.crowns ?? 0;

    let state: NodeState;
    if (!entry.lesson.authored) {
      state = "locked";
    } else if (!previousPassed) {
      state = "locked";
    } else if (crowns >= RULES.maxCrowns) {
      state = "mastered";
    } else if (completions > 0) {
      state = "complete";
    } else {
      state = "available";
    }

    if (state !== "locked" && state !== "mastered" && !nextLessonId && completions === 0) {
      nextLessonId = entry.lesson.id;
    }

    nodes.push({
      lessonId: entry.lesson.id,
      unitId: entry.unit.id,
      title: entry.lesson.title,
      kind: entry.lesson.kind,
      authored: entry.lesson.authored,
      exerciseCount: entry.lesson.exercises.length,
      state,
      crowns,
      bestScore: lp?.bestScore ?? 0,
      unitIndex: entry.unitIndex,
      lessonIndex: entry.lessonIndex,
      globalIndex: entry.globalIndex,
    });

    previousPassed = completions > 0;
  }

  // Everything done once? Point "Continue" at the least-mastered lesson instead.
  if (!nextLessonId) {
    const playable = nodes.filter((n) => n.state !== "locked");
    const weakest = [...playable].sort((a, b) => a.crowns - b.crowns || a.bestScore - b.bestScore)[0];
    nextLessonId = weakest?.lessonId ?? null;
  }

  const lessonsComplete = nodes.filter((n) => n.state === "complete" || n.state === "mastered").length;
  const crownsEarned = nodes.reduce((n, node) => n + node.crowns, 0);
  const crownsPossible = nodes.length * RULES.maxCrowns;
  const unitsComplete = course.units.filter((u) =>
    u.lessons.every((l) => (progress.lessons[l.id]?.completions ?? 0) > 0),
  ).length;

  const dueCount = Object.values(progress.cards).filter(
    (c) => c.courseId === course.id && new Date(c.dueAt).getTime() <= now.getTime(),
  ).length;

  return {
    courseId: course.id,
    nodes,
    unitsComplete,
    lessonsComplete,
    lessonsTotal: nodes.length,
    crownsEarned,
    crownsPossible,
    percent: crownsPossible === 0 ? 0 : Math.round((crownsEarned / crownsPossible) * 100),
    nextLessonId,
    dueCount,
  };
}

export interface WeakArea {
  tag: string;
  strength: number;
  cardCount: number;
  lessonIds: string[];
}

/** Concept tags the learner is shakiest on, for targeted practice. */
export function weakAreas(course: Course, progress: Progress, now = new Date(), limit = 6): WeakArea[] {
  const byTag = new Map<string, { total: number; count: number; lessons: Set<string> }>();

  for (const unit of course.units) {
    for (const lesson of unit.lessons) {
      for (const exercise of lesson.exercises) {
        const card = progress.cards[exercise.id];
        if (!card) continue;
        const strength = cardStrength(card, now);
        const tags = exercise.tags.length ? exercise.tags : [lesson.title];
        for (const tag of tags) {
          const entry = byTag.get(tag) ?? { total: 0, count: 0, lessons: new Set<string>() };
          entry.total += strength;
          entry.count += 1;
          entry.lessons.add(lesson.id);
          byTag.set(tag, entry);
        }
      }
    }
  }

  return [...byTag.entries()]
    .map(([tag, e]) => ({
      tag,
      strength: Math.round((e.total / e.count) * 100) / 100,
      cardCount: e.count,
      lessonIds: [...e.lessons],
    }))
    .sort((a, b) => a.strength - b.strength)
    .slice(0, limit);
}

/** Record the outcome of a finished lesson and return the XP awarded. */
export function completeLesson(
  progress: Progress,
  courseId: string,
  lessonId: string,
  opts: { score: number; correctCount: number; perfect: boolean },
  now = new Date(),
): { progress: Progress; xpAwarded: number; crownEarned: boolean } {
  const passed = opts.score >= RULES.passThreshold;
  const existing = progress.lessons[lessonId];
  const prevCrowns = existing?.crowns ?? 0;
  // A crown per pass, capped — repeating a mastered lesson still pays XP but no crown.
  const crownEarned = passed && prevCrowns < RULES.maxCrowns;

  const lessonProgress: LessonProgress = {
    lessonId,
    courseId,
    completions: (existing?.completions ?? 0) + (passed ? 1 : 0),
    crowns: crownEarned ? prevCrowns + 1 : prevCrowns,
    bestScore: Math.max(existing?.bestScore ?? 0, opts.score),
    lastScore: opts.score,
    lastCompletedAt: passed ? now.toISOString() : existing?.lastCompletedAt,
  };

  let xpAwarded = opts.correctCount * RULES.xpPerCorrect;
  if (passed) xpAwarded += RULES.xpLessonComplete;
  if (opts.perfect) xpAwarded += RULES.xpPerfectBonus;

  let next: Progress = {
    ...progress,
    lessons: { ...progress.lessons, [lessonId]: lessonProgress },
    courses: {
      ...progress.courses,
      [courseId]: {
        startedAt: progress.courses[courseId]?.startedAt ?? now.toISOString(),
        lastStudiedAt: now.toISOString(),
      },
    },
  };
  next = awardXp(next, xpAwarded, now);
  next = touchStreak(next, now);

  return { progress: next, xpAwarded, crownEarned };
}
