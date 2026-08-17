import { BLANK_MARKER, type Exercise } from "./schema.js";

/**
 * Grading is deliberately split in two:
 *
 *  - Everything except `short_answer` grades **deterministically and locally**, so the
 *    player is instant and works with no model in the loop at all.
 *  - `short_answer` gets a local key-point heuristic immediately, and is optionally
 *    upgraded by an LLM pass (see the server's grader queue). The heuristic result is
 *    always returned first so the UI never blocks on a model.
 */

export type Answer =
  | { kind: "choice"; value: string }
  | { kind: "choices"; values: string[] }
  | { kind: "boolean"; value: boolean }
  | { kind: "blanks"; values: string[] }
  | { kind: "pairs"; values: Array<{ left: string; right: string }> }
  | { kind: "order"; values: string[] }
  | { kind: "categorize"; values: Array<{ text: string; category: string }> }
  | { kind: "text"; value: string }
  | { kind: "selfRated"; value: "again" | "hard" | "good" | "easy" };

export interface GradeResult {
  correct: boolean;
  /** 0..1. Partial credit drives SRS scheduling even when `correct` is false. */
  score: number;
  /** Learner-facing feedback line. */
  feedback: string;
  /** The canonical answer, rendered for the "correct solution" panel. */
  correctAnswer?: string;
  /** True when an LLM pass could still improve this verdict. */
  provisional?: boolean;
  /** Per-item correctness, for exercises the UI marks up in place. */
  detail?: Array<{ label: string; correct: boolean }>;
}

/** Normalise free text for comparison: case, accents, punctuation, whitespace. */
export function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.,;:!?()[\]{}"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Levenshtein distance, capped for performance on long strings. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[b.length]!;
}

/**
 * Accept near-misses on typed answers the way Duolingo does: a one-character typo in
 * a long word is a pass, but short words must be exact or "cat"/"cap" would both pass.
 */
export function isTypoMatch(given: string, expected: string): boolean {
  const g = normalizeText(given);
  const e = normalizeText(expected);
  if (g === e) return true;
  if (e.length < 5) return false;
  const tolerance = e.length >= 10 ? 2 : 1;
  return editDistance(g, e) <= tolerance;
}

function matchesAny(given: string, accepted: string[]): { hit: boolean; exact: boolean } {
  for (const candidate of accepted) {
    if (normalizeText(given) === normalizeText(candidate)) return { hit: true, exact: true };
  }
  for (const candidate of accepted) {
    if (isTypoMatch(given, candidate)) return { hit: true, exact: false };
  }
  return { hit: false, exact: false };
}

/** Overlap of significant words, used as a cheap key-point coverage signal. */
function keywordCoverage(answer: string, keyPoint: string): number {
  const stop = new Set([
    "the", "a", "an", "of", "to", "in", "is", "are", "and", "or", "that", "this", "it",
    "as", "by", "for", "with", "on", "at", "be", "can", "will", "its", "from", "when",
  ]);
  const words = (s: string) =>
    new Set(normalizeText(s).split(" ").filter((w) => w.length > 2 && !stop.has(w)));
  const target = words(keyPoint);
  if (target.size === 0) return 1;
  const given = words(answer);
  let hits = 0;
  for (const word of target) {
    if (given.has(word)) {
      hits++;
      continue;
    }
    // credit stem-ish matches: "magnetization" covers "magnetize"
    for (const g of given) {
      if (g.length > 4 && (g.startsWith(word.slice(0, 5)) || word.startsWith(g.slice(0, 5)))) {
        hits++;
        break;
      }
    }
  }
  return hits / target.size;
}

const joinList = (items: string[]) => items.map((i) => `“${i}”`).join(", ");

export function gradeExercise(exercise: Exercise, answer: Answer): GradeResult {
  switch (exercise.type) {
    case "multiple_choice": {
      if (answer.kind !== "choice") return badAnswerKind("choice");
      const correct = answer.value === exercise.answer;
      return {
        correct,
        score: correct ? 1 : 0,
        feedback: correct ? "Correct!" : "Not quite.",
        correctAnswer: exercise.answer,
      };
    }

    case "multi_select": {
      if (answer.kind !== "choices") return badAnswerKind("choices");
      const expected = new Set(exercise.answers);
      const given = new Set(answer.values);
      const hits = [...given].filter((v) => expected.has(v)).length;
      const misses = [...expected].filter((v) => !given.has(v)).length;
      const extras = [...given].filter((v) => !expected.has(v)).length;
      const correct = misses === 0 && extras === 0;
      // Partial credit: reward hits, penalise false positives.
      const score = correct ? 1 : Math.max(0, (hits - extras) / expected.size);
      return {
        correct,
        score,
        feedback: correct
          ? "Correct!"
          : extras > 0 && misses > 0
            ? "Some selections are wrong and you missed some."
            : extras > 0
              ? "You selected something that doesn't belong."
              : "You missed one.",
        correctAnswer: joinList(exercise.answers),
        detail: exercise.choices.map((c) => ({ label: c, correct: expected.has(c) })),
      };
    }

    case "true_false": {
      if (answer.kind !== "boolean") return badAnswerKind("boolean");
      const correct = answer.value === exercise.answer;
      return {
        correct,
        score: correct ? 1 : 0,
        feedback: correct ? "Correct!" : "Not quite.",
        correctAnswer: exercise.answer ? "True" : "False",
      };
    }

    case "fill_blank": {
      if (answer.kind !== "blanks") return badAnswerKind("blanks");
      const detail: GradeResult["detail"] = [];
      let hits = 0;
      let anyTypo = false;
      exercise.blanks.forEach((blank, i) => {
        const given = answer.values[i] ?? "";
        const { hit, exact } = matchesAny(given, blank.accepted);
        if (hit) {
          hits++;
          if (!exact) anyTypo = true;
        }
        detail.push({ label: blank.accepted[0]!, correct: hit });
      });
      const correct = hits === exercise.blanks.length;
      return {
        correct,
        score: hits / exercise.blanks.length,
        feedback: correct ? (anyTypo ? "Correct — watch the spelling." : "Correct!") : "Not quite.",
        correctAnswer: exercise.blanks.map((b) => b.accepted[0]!).join(" / "),
        detail,
      };
    }

    case "match_pairs": {
      if (answer.kind !== "pairs") return badAnswerKind("pairs");
      const expected = new Map(exercise.pairs.map((p) => [p.left, p.right]));
      let hits = 0;
      const detail: GradeResult["detail"] = [];
      for (const given of answer.values) {
        const ok = expected.get(given.left) === given.right;
        if (ok) hits++;
        detail.push({ label: `${given.left} → ${given.right}`, correct: ok });
      }
      const correct = hits === exercise.pairs.length;
      return {
        correct,
        score: hits / exercise.pairs.length,
        feedback: correct ? "All matched!" : `${hits} of ${exercise.pairs.length} matched.`,
        correctAnswer: exercise.pairs.map((p) => `${p.left} → ${p.right}`).join("; "),
        detail,
      };
    }

    case "order_sequence": {
      if (answer.kind !== "order") return badAnswerKind("order");
      const expected = exercise.items;
      const given = answer.values;
      let inPlace = 0;
      expected.forEach((item, i) => {
        if (given[i] === item) inPlace++;
      });
      const correct = inPlace === expected.length;
      return {
        correct,
        score: inPlace / expected.length,
        feedback: correct ? "Perfect order!" : `${inPlace} of ${expected.length} in the right place.`,
        correctAnswer: expected.map((item, i) => `${i + 1}. ${item}`).join("  "),
        detail: given.map((item, i) => ({ label: item, correct: expected[i] === item })),
      };
    }

    case "categorize": {
      if (answer.kind !== "categorize") return badAnswerKind("categorize");
      const expected = new Map(exercise.items.map((i) => [i.text, i.category]));
      let hits = 0;
      const detail: GradeResult["detail"] = [];
      for (const given of answer.values) {
        const ok = expected.get(given.text) === given.category;
        if (ok) hits++;
        detail.push({ label: given.text, correct: ok });
      }
      const correct = hits === exercise.items.length;
      return {
        correct,
        score: hits / exercise.items.length,
        feedback: correct ? "All sorted correctly!" : `${hits} of ${exercise.items.length} in the right bucket.`,
        correctAnswer: exercise.items.map((i) => `${i.text} → ${i.category}`).join("; "),
        detail,
      };
    }

    case "short_answer": {
      if (answer.kind !== "text") return badAnswerKind("text");
      const text = answer.value.trim();
      const words = text.split(/\s+/).filter(Boolean).length;
      if (words < exercise.minWords) {
        return {
          correct: false,
          score: 0,
          feedback: `Give it a bit more — aim for at least ${exercise.minWords} words.`,
          correctAnswer: exercise.exemplar,
        };
      }
      const coverages = exercise.keyPoints.map((kp) => keywordCoverage(text, kp));
      const covered = coverages.filter((c) => c >= 0.5).length;
      const score = coverages.reduce((a, b) => a + b, 0) / coverages.length;
      const correct = covered === exercise.keyPoints.length || score >= 0.75;
      return {
        correct,
        score,
        // The heuristic can only see vocabulary overlap, so never state a hard verdict.
        feedback: correct
          ? "Looks right — checking the details…"
          : `Covered ${covered} of ${exercise.keyPoints.length} key ideas — checking…`,
        correctAnswer: exercise.exemplar,
        provisional: true,
        detail: exercise.keyPoints.map((kp, i) => ({ label: kp, correct: coverages[i]! >= 0.5 })),
      };
    }

    case "flashcard": {
      if (answer.kind !== "selfRated") return badAnswerKind("selfRated");
      const score = { again: 0, hard: 0.5, good: 0.85, easy: 1 }[answer.value];
      return {
        correct: score >= 0.5,
        score,
        feedback: score >= 0.5 ? "Nice." : "We'll bring this one back soon.",
        correctAnswer: exercise.back,
      };
    }
  }
}

function badAnswerKind(expected: string): GradeResult {
  return {
    correct: false,
    score: 0,
    feedback: `Internal error: expected an answer of kind "${expected}".`,
  };
}

/** Which `Answer.kind` the UI must submit for a given exercise type. */
export function answerKindFor(type: Exercise["type"]): Answer["kind"] {
  switch (type) {
    case "multiple_choice": return "choice";
    case "multi_select": return "choices";
    case "true_false": return "boolean";
    case "fill_blank": return "blanks";
    case "match_pairs": return "pairs";
    case "order_sequence": return "order";
    case "categorize": return "categorize";
    case "short_answer": return "text";
    case "flashcard": return "selfRated";
  }
}

/** Split a fill_blank prompt into the literal segments around each blank. */
export function splitBlanks(prompt: string): string[] {
  return prompt.split(BLANK_MARKER);
}
