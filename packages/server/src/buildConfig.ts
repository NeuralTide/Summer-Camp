import { prefixedId, type BuildConfig, type CoursePlan, type PlanUnit, type Unit } from "@metaharness/core";
import { HttpError } from "./http.js";

/**
 * Turns agent- or user-submitted plan units into stored units/lessons, minting
 * fresh ids. Shared by every endpoint that writes a course's outline
 * (course_plan, manual creation, outline edits) so id generation stays in one
 * place. Ids are always regenerated rather than preserved across edits —
 * nothing downstream (no exercises, no progress) references a lesson id until
 * it's actually authored, so there's no stability requirement to honour here.
 */
export function toStoredUnits(units: PlanUnit[]): Unit[] {
  return units.map((unit) => ({
    id: prefixedId("unt", 6),
    title: unit.title,
    description: unit.description,
    lessons: unit.lessons.map((lesson) => ({
      id: prefixedId("lsn", 6),
      title: lesson.title,
      objective: lesson.objective,
      kind: lesson.kind,
      notes: "",
      exercises: [],
      authored: false,
    })),
  }));
}

/**
 * Hard limits, not just prompt suggestions. Checked wherever a plan gets
 * written (agent-authored or hand-built), mirroring the rest of the schema's
 * philosophy: a plan that overshoots comes back as a specific, fixable error
 * rather than silently producing a bigger — and more expensive — course than
 * was asked for. `maxSources` is a soft cap instead: sources aren't retried
 * content, so overshooting one just gets trimmed rather than rejected.
 */
export function enforceBuildConfig(plan: CoursePlan, config: BuildConfig): CoursePlan {
  if (plan.units.length > config.maxUnits) {
    throw new HttpError(
      400,
      `Plan has ${plan.units.length} units, which is more than the configured limit of ${config.maxUnits}. Trim it down.`,
    );
  }
  for (const unit of plan.units) {
    if (unit.lessons.length > config.maxLessonsPerUnit) {
      throw new HttpError(
        400,
        `Unit "${unit.title}" has ${unit.lessons.length} lessons, which is more than the configured limit of ${config.maxLessonsPerUnit} lessons per unit. Trim it down.`,
      );
    }
  }
  return { ...plan, sources: plan.sources.slice(0, config.maxSources) };
}
