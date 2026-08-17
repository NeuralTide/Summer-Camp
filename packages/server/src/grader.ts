import type { Exercise, GradeResult, Store } from "@metaharness/core";
import type { DriverRegistry } from "@metaharness/harness";
import type { EventBus } from "./bus.js";
import { gradeShortAnswerPrompt } from "./prompts.js";

/**
 * LLM grading for free-text answers.
 *
 * Reuses the same driver layer as authoring, which means metaharness never needs a
 * model API key of its own — it borrows whatever agent CLI the user has already
 * authenticated. The local heuristic has already returned a provisional verdict by
 * the time this runs, so the learner is never left waiting on a subprocess; the
 * result arrives over SSE and the UI revises the card in place.
 */

const GRADE_TIMEOUT_MS = 90_000;

export class Grader {
  /** Coalesces duplicate grade requests for the same answer. */
  private inflight = new Map<string, Promise<GradeResult | undefined>>();

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly registry: DriverRegistry,
  ) {}

  /**
   * Grade in the background and broadcast the revised verdict. Returns immediately.
   */
  enqueue(exercise: Exercise, answer: string, provisional: GradeResult): void {
    if (exercise.type !== "short_answer") return;
    if (!this.store.getConfig().llmGrading) return;

    const key = `${exercise.id}:${answer}`;
    if (this.inflight.has(key)) return;

    const task = this.grade(exercise, answer)
      .then((result) => {
        if (!result) return undefined;
        // Only speak up when the model disagrees with the heuristic, or adds detail.
        const changed = result.correct !== provisional.correct || result.feedback !== provisional.feedback;
        if (changed) {
          this.bus.emit({
            type: "grade.updated",
            exerciseId: exercise.id,
            correct: result.correct,
            score: result.score,
            feedback: result.feedback,
          });
        }
        return result;
      })
      .catch(() => undefined)
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, task);
  }

  private async grade(exercise: Exercise, answer: string): Promise<GradeResult | undefined> {
    if (exercise.type !== "short_answer") return undefined;

    let driver;
    try {
      // Grading is a plain prompt-in/text-out job, so an MCP-less CLI is fine here.
      ({ driver } = await this.registry.resolve(this.store.getConfig().driver, { requireMcp: false }));
    } catch {
      return undefined;
    }

    const result = await driver.run({
      prompt: gradeShortAnswerPrompt({
        question: exercise.prompt,
        keyPoints: exercise.keyPoints,
        exemplar: exercise.exemplar,
        answer,
      }),
      timeoutMs: GRADE_TIMEOUT_MS,
      allowedTools: [],
    });

    if (!result.ok) return undefined;
    return parseGrade(result.text);
  }
}

/**
 * Pull the verdict out of the model's reply. Models wrap JSON in prose or code
 * fences often enough that the last balanced object in the text is a more reliable
 * target than the whole string.
 */
export function parseGrade(text: string): GradeResult | undefined {
  const candidate = extractJsonObject(text);
  if (!candidate) return undefined;

  let parsed: any;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  if (typeof parsed.correct !== "boolean") return undefined;

  const score =
    typeof parsed.score === "number" && Number.isFinite(parsed.score)
      ? Math.max(0, Math.min(1, parsed.score))
      : parsed.correct
        ? 1
        : 0;

  const missed = Array.isArray(parsed.missed) ? parsed.missed.filter((m: unknown) => typeof m === "string") : [];

  return {
    correct: parsed.correct,
    score,
    feedback: typeof parsed.feedback === "string" && parsed.feedback.trim() ? parsed.feedback.trim() : parsed.correct ? "Correct." : "Not quite.",
    provisional: false,
    ...(missed.length ? { detail: missed.map((m: string) => ({ label: m, correct: false })) } : {}),
  };
}

/** Find the last complete `{...}` in a string, ignoring braces inside strings. */
function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const haystack = fenced?.[1] ?? text;

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  let best: string | undefined;

  for (let i = 0; i < haystack.length; i++) {
    const char = haystack[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && start >= 0) best = haystack.slice(start, i + 1);
      if (depth < 0) depth = 0;
    }
  }
  return best;
}
