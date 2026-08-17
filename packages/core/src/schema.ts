import { z } from "zod";

/**
 * The content schema is the contract between the authoring agent and the player UI.
 *
 * Two design rules keep agent-authored content reliable:
 *
 *  1. Answers are referenced by *literal value*, never by index or id. An LLM
 *     repeating the correct option verbatim is far more reliable than an LLM
 *     counting to the right 0-based index.
 *  2. Every cross-field invariant is expressed as a refinement, so a bad write
 *     comes back to the agent as a specific, fixable error message instead of
 *     silently producing an ungradable exercise.
 */

export const BLANK_MARKER = "___";

const nonEmpty = (label: string, max = 2000) =>
  z.string().trim().min(1, `${label} must not be empty`).max(max);

export const CodeBlockSchema = z.object({
  language: nonEmpty("code.language", 30).describe("Highlight.js-style language id, e.g. 'python'"),
  source: nonEmpty("code.source", 4000),
});
export type CodeBlock = z.infer<typeof CodeBlockSchema>;

const ExerciseBase = {
  id: z.string().default(""),
  prompt: nonEmpty("prompt"),
  explanation: z.string().trim().max(1200).optional().describe("Shown after answering. Explain *why*."),
  hint: z.string().trim().max(400).optional(),
  difficulty: z.number().int().min(1).max(3).default(2),
  tags: z.array(nonEmpty("tag", 60)).default([]).describe("Concept tags, used for weak-area analysis"),
  code: CodeBlockSchema.optional().describe("Optional snippet rendered above the prompt"),
};
/**
 * Union members are plain objects with no refinements: zod v3's
 * `discriminatedUnion` only accepts ZodObject, and a `.superRefine()` returns a
 * ZodEffects. All cross-field invariants therefore live in `refineExercise`
 * below and are applied to the union as a whole, which validates identically
 * while keeping the discriminated type intact.
 */

/** Choose exactly one correct option. */
export const MultipleChoiceSchema = z.object({
  ...ExerciseBase,
  type: z.literal("multiple_choice"),
  choices: z.array(nonEmpty("choice", 400)).min(2).max(6),
  answer: nonEmpty("answer", 400).describe("Must be character-identical to one entry in `choices`"),
});

/** Choose every correct option; partial selections are wrong. */
export const MultiSelectSchema = z.object({
  ...ExerciseBase,
  type: z.literal("multi_select"),
  choices: z.array(nonEmpty("choice", 400)).min(3).max(8),
  answers: z.array(nonEmpty("answer", 400)).min(1).describe("Each must appear verbatim in `choices`"),
});

export const TrueFalseSchema = z.object({
  ...ExerciseBase,
  type: z.literal("true_false"),
  prompt: nonEmpty("prompt").describe("A single claim the learner judges true or false"),
  answer: z.boolean(),
});

export const BlankSchema = z.object({
  accepted: z
    .array(nonEmpty("accepted answer", 200))
    .min(1)
    .describe("All acceptable spellings/synonyms. The first is the canonical one."),
});

/** Prompt contains one `___` per blank, filled by typing or from a word bank. */
export const FillBlankSchema = z.object({
  ...ExerciseBase,
  type: z.literal("fill_blank"),
  prompt: nonEmpty("prompt").describe(`Use ${BLANK_MARKER} (three underscores) for each blank`),
  blanks: z.array(BlankSchema).min(1).max(4),
  wordBank: z
    .array(nonEmpty("word", 200))
    .max(10)
    .optional()
    .describe("Optional tap-to-fill tiles. Must contain every canonical answer, plus distractors."),
});

export const PairSchema = z.object({
  left: nonEmpty("pair.left", 200),
  right: nonEmpty("pair.right", 200),
});

/** Tap matching tiles until every pair is cleared. */
export const MatchPairsSchema = z.object({
  ...ExerciseBase,
  type: z.literal("match_pairs"),
  pairs: z.array(PairSchema).min(3).max(6),
});

/** Drag shuffled items back into the correct order. */
export const OrderSequenceSchema = z.object({
  ...ExerciseBase,
  type: z.literal("order_sequence"),
  items: z
    .array(nonEmpty("item", 300))
    .min(3)
    .max(7)
    .describe("Listed in the CORRECT order; the UI shuffles them"),
});

/** Sort items into buckets. */
export const CategorizeSchema = z.object({
  ...ExerciseBase,
  type: z.literal("categorize"),
  categories: z.array(nonEmpty("category", 80)).min(2).max(4),
  items: z
    .array(z.object({ text: nonEmpty("item.text", 200), category: nonEmpty("item.category", 80) }))
    .min(4)
    .max(10),
});

/** Free-text answer, graded by key-point coverage and (optionally) an LLM. */
export const ShortAnswerSchema = z.object({
  ...ExerciseBase,
  type: z.literal("short_answer"),
  keyPoints: z
    .array(nonEmpty("key point", 300))
    .min(1)
    .max(5)
    .describe("The ideas a correct answer must contain. Used for both offline and LLM grading."),
  exemplar: nonEmpty("exemplar", 1500).describe("A model answer shown to the learner afterwards"),
  minWords: z.number().int().min(1).max(200).default(5),
});

/** Recall card used in spaced-repetition practice; self-graded. */
export const FlashcardSchema = z.object({
  ...ExerciseBase,
  type: z.literal("flashcard"),
  back: nonEmpty("back", 1200),
});

const ExerciseUnion = z.discriminatedUnion("type", [
  MultipleChoiceSchema,
  MultiSelectSchema,
  TrueFalseSchema,
  FillBlankSchema,
  MatchPairsSchema,
  OrderSequenceSchema,
  CategorizeSchema,
  ShortAnswerSchema,
  FlashcardSchema,
]);

export type Exercise = z.infer<typeof ExerciseUnion>;
export type ExerciseType = Exercise["type"];

/**
 * Every invariant that spans two fields of one exercise. These are the mistakes
 * authoring models actually make, and each message names the offending values so
 * the agent can repair the exercise without guessing.
 */
function refineExercise(ex: Exercise, ctx: z.RefinementCtx): void {
  switch (ex.type) {
    case "multiple_choice": {
      if (!ex.choices.includes(ex.answer)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answer"],
          message: `answer ${JSON.stringify(ex.answer)} is not one of choices ${JSON.stringify(ex.choices)}`,
        });
      }
      if (new Set(ex.choices).size !== ex.choices.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "choices must be unique" });
      }
      break;
    }

    case "multi_select": {
      for (const a of ex.answers) {
        if (!ex.choices.includes(a)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["answers"],
            message: `answer ${JSON.stringify(a)} is not one of choices ${JSON.stringify(ex.choices)}`,
          });
        }
      }
      if (ex.answers.length === ex.choices.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answers"],
          message: "at least one choice must be incorrect, otherwise the exercise is trivial",
        });
      }
      break;
    }

    case "fill_blank": {
      const markers = ex.prompt.split(BLANK_MARKER).length - 1;
      if (markers !== ex.blanks.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prompt"],
          message: `prompt contains ${markers} "${BLANK_MARKER}" marker(s) but ${ex.blanks.length} blank(s) were defined; they must match`,
        });
      }
      if (ex.wordBank) {
        for (const blank of ex.blanks) {
          const canonical = blank.accepted[0]!;
          if (!ex.wordBank.some((w) => w.toLowerCase() === canonical.toLowerCase())) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["wordBank"],
              message: `wordBank is missing the canonical answer ${JSON.stringify(canonical)}`,
            });
          }
        }
        if (ex.wordBank.length <= ex.blanks.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["wordBank"],
            message: "wordBank needs at least one distractor beyond the correct answers",
          });
        }
      }
      break;
    }

    case "match_pairs": {
      const lefts = ex.pairs.map((p) => p.left);
      const rights = ex.pairs.map((p) => p.right);
      if (new Set(lefts).size !== lefts.length || new Set(rights).size !== rights.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["pairs"],
          message: "every left and every right value must be unique, otherwise matching is ambiguous",
        });
      }
      break;
    }

    case "order_sequence": {
      if (new Set(ex.items).size !== ex.items.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "items must be unique" });
      }
      break;
    }

    case "categorize": {
      for (const item of ex.items) {
        if (!ex.categories.includes(item.category)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["items"],
            message: `item ${JSON.stringify(item.text)} has category ${JSON.stringify(item.category)} which is not in ${JSON.stringify(ex.categories)}`,
          });
        }
      }
      const used = new Set(ex.items.map((i) => i.category));
      for (const c of ex.categories) {
        if (!used.has(c)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["categories"],
            message: `category ${JSON.stringify(c)} has no items; every category needs at least one`,
          });
        }
      }
      break;
    }

    case "true_false":
    case "short_answer":
    case "flashcard":
      break;
  }
}

export const ExerciseSchema = ExerciseUnion.superRefine(refineExercise);

export const EXERCISE_TYPES: ExerciseType[] = [
  "multiple_choice",
  "multi_select",
  "true_false",
  "fill_blank",
  "match_pairs",
  "order_sequence",
  "categorize",
  "short_answer",
  "flashcard",
];

/** Types that carry enough signal to be worth scheduling for spaced review. */
export const REVIEWABLE_TYPES = new Set<ExerciseType>(EXERCISE_TYPES);

export const LessonKindSchema = z.enum(["concept", "practice", "checkpoint"]);
export type LessonKind = z.infer<typeof LessonKindSchema>;

export const LessonSchema = z.object({
  id: z.string().default(""),
  title: nonEmpty("lesson.title", 120),
  objective: nonEmpty("lesson.objective", 400).describe("One sentence: what the learner can do afterwards"),
  kind: LessonKindSchema.default("concept"),
  /** Markdown taught before the exercises begin. Supports $math$ and ```code fences. */
  notes: z.string().max(8000).default(""),
  exercises: z.array(ExerciseSchema).default([]),
  authored: z.boolean().default(false).describe("False while the lesson is still a planned stub"),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const UnitSchema = z.object({
  id: z.string().default(""),
  title: nonEmpty("unit.title", 120),
  description: z.string().trim().max(600).default(""),
  lessons: z.array(LessonSchema).min(1),
});
export type Unit = z.infer<typeof UnitSchema>;

export const SourceSchema = z.object({
  title: nonEmpty("source.title", 300),
  url: z.string().url().optional(),
  note: z.string().max(600).optional(),
});
export type Source = z.infer<typeof SourceSchema>;

/**
 * "reviewing" sits between planning and authoring: a course has a full
 * unit/lesson skeleton (titles + objectives, nothing authored) and no job
 * running, waiting on the learner to approve or edit the outline before any
 * lesson content gets written. Both "Build with me" (agent-drafted) and
 * "Let me build it" (hand-drafted) land here.
 */
export const CourseStatusSchema = z.enum(["planning", "reviewing", "authoring", "ready", "failed"]);
export type CourseStatus = z.infer<typeof CourseStatusSchema>;

export const CourseLevelSchema = z.enum(["beginner", "intermediate", "advanced"]);
export type CourseLevel = z.infer<typeof CourseLevelSchema>;

/**
 * How much of the build the agent does unsupervised:
 *  - "auto"   — research, plan, and write the whole course with no checkpoint (today's only mode).
 *  - "review" — research and plan, then stop at "reviewing" for the outline to be approved/edited.
 *  - "manual" — no agent research/planning at all; the learner hand-builds the outline and the
 *               agent is only used afterward, to write each lesson's content.
 */
export const CurationModeSchema = z.enum(["auto", "review", "manual"]);
export type CurationMode = z.infer<typeof CurationModeSchema>;

/**
 * Hard, enforced limits on a build — not just prompt suggestions. These are
 * checked at every endpoint that writes course content (course_plan,
 * research_note, lesson_write), so an agent that ignores the prompt's
 * numbers gets a specific, fixable error back instead of silently producing
 * a much bigger (and more expensive) course than asked for.
 */
export const BuildConfigSchema = z.object({
  maxUnits: z.number().int().min(1).max(8).default(6),
  maxLessonsPerUnit: z.number().int().min(1).max(8).default(6),
  /** 0 disables research citations entirely; research itself is governed by skipResearch. */
  maxSources: z.number().int().min(0).max(20).default(8),
  maxExercisesPerLesson: z.number().int().min(3).max(12).default(8),
  /** Skip web search during planning and author from model knowledge alone. */
  skipResearch: z.boolean().default(false),
  /**
   * How many units to keep written ahead of the learner. 0 writes the whole
   * course up front, as builds used to.
   *
   * Authoring a course is the expensive thing this app does, and most of that
   * spend is on units nobody has reached — a 6-unit course costs about seven
   * times a single unit, and a learner who abandons after unit 2 paid for four
   * they never opened. Writing just ahead of the reader turns that into
   * pay-as-you-go without them ever waiting on it.
   */
  authorAhead: z.number().int().min(0).max(8).default(1),
});
export type BuildConfig = z.infer<typeof BuildConfigSchema>;

export const CourseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: nonEmpty("course.title", 140),
  topic: nonEmpty("course.topic", 300).describe("The learner's original request, verbatim"),
  description: z.string().trim().max(1200).default(""),
  level: CourseLevelSchema.default("beginner"),
  status: CourseStatusSchema.default("planning"),
  curation: CurationModeSchema.default("auto"),
  buildConfig: BuildConfigSchema.default({}),
  /** Hex accent colour driving the whole course theme. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#769826"),
  units: z.array(UnitSchema).default([]),
  sources: z.array(SourceSchema).default([]),
  researchNotes: z.string().max(20000).default(""),
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z.string().optional(),
});
export type Course = z.infer<typeof CourseSchema>;

/* ------------------------------------------------------------------ */
/* Authoring input shapes (what the MCP tools accept from the agent)   */
/* ------------------------------------------------------------------ */

export const PlanLessonSchema = z.object({
  title: nonEmpty("lesson.title", 120),
  objective: nonEmpty("lesson.objective", 400),
  kind: LessonKindSchema.default("concept"),
});
export type PlanLesson = z.infer<typeof PlanLessonSchema>;

export const PlanUnitSchema = z.object({
  title: nonEmpty("unit.title", 120),
  description: z.string().trim().max(600).default(""),
  lessons: z.array(PlanLessonSchema).min(1).max(8),
});
export type PlanUnit = z.infer<typeof PlanUnitSchema>;

export const CoursePlanSchema = z.object({
  title: nonEmpty("course.title", 140),
  description: z.string().trim().max(1200).default(""),
  level: CourseLevelSchema.default("beginner"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#769826"),
  units: z.array(PlanUnitSchema).min(1).max(8),
  sources: z.array(SourceSchema).default([]),
});
export type CoursePlan = z.infer<typeof CoursePlanSchema>;

export const LessonWriteSchema = z.object({
  notes: z.string().max(8000).default(""),
  exercises: z.array(ExerciseSchema).min(3).max(12),
});
export type LessonWrite = z.infer<typeof LessonWriteSchema>;

/* ------------------------------------------------------------------ */
/* Error formatting — agents fix what they can read                    */
/* ------------------------------------------------------------------ */

/** Render a ZodError as a flat list of `path: message` lines an LLM can act on. */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `- ${path}: ${issue.message}`;
    })
    .join("\n");
}

export function totalLessons(course: Course): number {
  return course.units.reduce((n, u) => n + u.lessons.length, 0);
}

export function authoredLessons(course: Course): number {
  return course.units.reduce((n, u) => n + u.lessons.filter((l) => l.authored).length, 0);
}

export function findLesson(course: Course, lessonId: string): { unit: Unit; lesson: Lesson } | undefined {
  for (const unit of course.units) {
    const lesson = unit.lessons.find((l) => l.id === lessonId);
    if (lesson) return { unit, lesson };
  }
  return undefined;
}

/** Flat, ordered list of every lesson with its unit context. */
export function lessonSequence(course: Course): Array<{ unit: Unit; unitIndex: number; lesson: Lesson; lessonIndex: number; globalIndex: number }> {
  const out: Array<{ unit: Unit; unitIndex: number; lesson: Lesson; lessonIndex: number; globalIndex: number }> = [];
  let global = 0;
  course.units.forEach((unit, unitIndex) => {
    unit.lessons.forEach((lesson, lessonIndex) => {
      out.push({ unit, unitIndex, lesson, lessonIndex, globalIndex: global++ });
    });
  });
  return out;
}
