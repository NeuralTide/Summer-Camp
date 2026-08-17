import type { Course, Exercise } from "./schema.js";
import { findLesson } from "./schema.js";
import { dueCards } from "./srs.js";
import type { Progress } from "./progress.js";

/**
 * A session hands the client *playable* exercises: correct answers stripped and
 * option order shuffled. Two reasons, and the second is the important one:
 *
 *  1. The answer key never reaches the browser.
 *  2. Authoring models have a strong positional bias — the correct option lands
 *     first far more often than chance. Shuffling server-side erases that tell.
 */

export interface PlayableBase {
  id: string;
  type: Exercise["type"];
  prompt: string;
  hint?: string;
  code?: { language: string; source: string };
  difficulty: number;
}

export type PlayableExercise =
  | (PlayableBase & { type: "multiple_choice"; choices: string[] })
  | (PlayableBase & { type: "multi_select"; choices: string[] })
  | (PlayableBase & { type: "true_false" })
  | (PlayableBase & { type: "fill_blank"; blankCount: number; wordBank?: string[] })
  | (PlayableBase & { type: "match_pairs"; lefts: string[]; rights: string[] })
  | (PlayableBase & { type: "order_sequence"; items: string[] })
  | (PlayableBase & { type: "categorize"; categories: string[]; items: string[] })
  | (PlayableBase & { type: "short_answer"; minWords: number })
  | (PlayableBase & { type: "flashcard"; back: string });

export interface Session {
  id: string;
  kind: "lesson" | "practice";
  courseId: string;
  courseTitle: string;
  courseColor: string;
  lessonId: string | null;
  lessonTitle: string;
  notes: string;
  exercises: PlayableExercise[];
}

/** Mulberry32 — small, fast, and deterministic so a session re-fetch is stable. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function toPlayable(exercise: Exercise, rng: () => number): PlayableExercise {
  const base: PlayableBase = {
    id: exercise.id,
    type: exercise.type,
    prompt: exercise.prompt,
    difficulty: exercise.difficulty,
    ...(exercise.hint ? { hint: exercise.hint } : {}),
    ...(exercise.code ? { code: exercise.code } : {}),
  };

  switch (exercise.type) {
    case "multiple_choice":
      return { ...base, type: "multiple_choice", choices: shuffle(exercise.choices, rng) };
    case "multi_select":
      return { ...base, type: "multi_select", choices: shuffle(exercise.choices, rng) };
    case "true_false":
      return { ...base, type: "true_false" };
    case "fill_blank":
      return {
        ...base,
        type: "fill_blank",
        blankCount: exercise.blanks.length,
        ...(exercise.wordBank ? { wordBank: shuffle(exercise.wordBank, rng) } : {}),
      };
    case "match_pairs":
      return {
        ...base,
        type: "match_pairs",
        lefts: shuffle(exercise.pairs.map((p) => p.left), rng),
        rights: shuffle(exercise.pairs.map((p) => p.right), rng),
      };
    case "order_sequence":
      return { ...base, type: "order_sequence", items: shuffle(exercise.items, rng) };
    case "categorize":
      return {
        ...base,
        type: "categorize",
        categories: shuffle(exercise.categories, rng),
        items: shuffle(exercise.items.map((i) => i.text), rng),
      };
    case "short_answer":
      return { ...base, type: "short_answer", minWords: exercise.minWords };
    case "flashcard":
      return { ...base, type: "flashcard", back: exercise.back };
  }
}

export function buildLessonSession(course: Course, lessonId: string, sessionId: string): Session | undefined {
  const found = findLesson(course, lessonId);
  if (!found || !found.lesson.authored) return undefined;
  const rng = seededRandom(sessionId);
  return {
    id: sessionId,
    kind: "lesson",
    courseId: course.id,
    courseTitle: course.title,
    courseColor: course.color,
    lessonId,
    lessonTitle: found.lesson.title,
    notes: found.lesson.notes,
    // Author order is pedagogical (easy → hard), so it is preserved; only options shuffle.
    exercises: found.lesson.exercises.map((ex) => toPlayable(ex, rng)),
  };
}

/**
 * Practice pulls whatever is due across the course, hardest-forgotten first, and
 * falls back to a spread of already-seen material when nothing is strictly due —
 * "Practice" should never open to an empty screen.
 */
export function buildPracticeSession(
  course: Course,
  progress: Progress,
  sessionId: string,
  opts: { limit?: number; lessonIds?: string[]; now?: Date } = {},
): Session | undefined {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 12;
  const rng = seededRandom(sessionId);

  const byId = new Map<string, Exercise>();
  const lessonOf = new Map<string, string>();
  for (const unit of course.units) {
    for (const lesson of unit.lessons) {
      if (!lesson.authored) continue;
      if (opts.lessonIds && !opts.lessonIds.includes(lesson.id)) continue;
      for (const ex of lesson.exercises) {
        byId.set(ex.id, ex);
        lessonOf.set(ex.id, lesson.id);
      }
    }
  }
  if (byId.size === 0) return undefined;

  const courseCards = Object.values(progress.cards).filter((c) => c.courseId === course.id && byId.has(c.exerciseId));
  const due = dueCards(courseCards, now, limit).map((c) => byId.get(c.exerciseId)!);

  let selected = due;
  if (selected.length < limit) {
    // Top up with seen-but-not-due, then never-seen, so practice always fills.
    const chosen = new Set(selected.map((e) => e.id));
    const seen = courseCards
      .filter((c) => !chosen.has(c.exerciseId))
      .sort((a, b) => a.avgScore - b.avgScore)
      .map((c) => byId.get(c.exerciseId)!);
    for (const ex of seen) {
      if (selected.length >= limit) break;
      selected.push(ex);
      chosen.add(ex.id);
    }
    if (selected.length < limit) {
      const unseen = shuffle([...byId.values()].filter((e) => !chosen.has(e.id)), rng);
      selected = selected.concat(unseen.slice(0, limit - selected.length));
    }
  }

  return {
    id: sessionId,
    kind: "practice",
    courseId: course.id,
    courseTitle: course.title,
    courseColor: course.color,
    lessonId: null,
    lessonTitle: "Practice",
    notes: "",
    exercises: shuffle(selected, rng).map((ex) => toPlayable(ex, rng)),
  };
}
