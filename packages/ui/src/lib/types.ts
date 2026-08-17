export type CourseStatus = "planning" | "reviewing" | "authoring" | "ready" | "failed";
export type CourseLevel = "beginner" | "intermediate" | "advanced";
export type NodeState = "locked" | "available" | "in_progress" | "complete" | "mastered";
export type BuildPhase = "starting" | "researching" | "planning" | "authoring" | "finishing" | "done" | "failed";

/**
 * How much of the build the agent does unsupervised — see CurationModeSchema
 * in @metaharness/core for the authoritative description of each mode.
 */
export type CurationMode = "auto" | "review" | "manual";

export interface BuildConfig {
  maxUnits: number;
  maxLessonsPerUnit: number;
  maxSources: number;
  maxExercisesPerLesson: number;
  skipResearch: boolean;
}

export interface PlanLesson {
  title: string;
  objective: string;
  kind: LessonStub["kind"];
}

export interface PlanUnit {
  title: string;
  description: string;
  lessons: PlanLesson[];
}

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  topic: string;
  description: string;
  level: CourseLevel;
  status: CourseStatus;
  color: string;
  unitCount: number;
  lessonCount: number;
  authoredCount: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface LessonStub {
  id: string;
  title: string;
  objective: string;
  kind: "concept" | "practice" | "checkpoint";
  authored: boolean;
  exerciseCount: number;
  hasNotes: boolean;
}

export interface UnitStub {
  id: string;
  title: string;
  description: string;
  lessons: LessonStub[];
}

export interface CourseTree extends CourseSummary {
  curation: CurationMode;
  buildConfig: BuildConfig;
  units: UnitStub[];
  researchNotes: string;
  sources: Array<{ title: string; url?: string; note?: string }>;
}

export interface LessonNode {
  lessonId: string;
  unitId: string;
  title: string;
  kind: LessonStub["kind"];
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
  nextLessonId: string | null;
  dueCount: number;
}

export interface Progress {
  xp: number;
  hearts: number;
  maxHearts: number;
  msToNextHeart: number | null;
  streak: { current: number; longest: number; lastStudyDay: string | null };
  dailyGoalXp: number;
  dailyXp: Record<string, number>;
  lessons: Record<string, { crowns: number; completions: number; bestScore: number }>;
  courses: Record<string, { startedAt: string; lastStudiedAt: string }>;
  dueByCourse: Record<string, number>;
}

export interface DriverStatus {
  id: string;
  name: string;
  available: boolean;
  version?: string;
  path?: string;
  supportsMcp: boolean;
  install: string;
  detail?: string;
  /** Names this CLI accepts, read off the binary where it will say. Advisory —
   *  a name outside the list is still valid. Empty means "no picker". */
  models?: string[];
  /** Effort levels this CLI accepts; empty where it has no such concept. */
  efforts?: string[];
}

export interface AppConfig {
  driver: string;
  /** Empty leaves the CLI on its own default. See AppConfig.model on the server. */
  model: string;
  /** Empty leaves the CLI on its own default. */
  effort: string;
  driverArgs: string[];
  customCommand: string;
  authorConcurrency: number;
  llmGrading: boolean;
  dailyGoalXp: number;
  unlimitedHearts: boolean;
}

export interface BuildLogEntry {
  at: string;
  level: "info" | "tool" | "text" | "warn" | "error";
  message: string;
  worker?: number;
}

export interface BuildJob {
  id: string;
  courseId: string;
  courseTitle: string;
  phase: BuildPhase;
  driver: string;
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  error?: string;
  log: BuildLogEntry[];
  authored: number;
  total: number;
}

interface PlayableBase {
  id: string;
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

export type ExerciseType = PlayableExercise["type"];

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
  score: number;
  feedback: string;
  correctAnswer?: string;
  provisional?: boolean;
  detail?: Array<{ label: string; correct: boolean }>;
}

export interface AnswerResponse {
  result: GradeResult;
  hearts: number;
  outOfHearts: boolean;
  explanation: string | null;
}

export interface CompleteResponse {
  score: number;
  perfect: boolean;
  xpAwarded: number;
  crownEarned: boolean;
  correctCount: number;
  total: number;
  passed: boolean;
  progress: Progress;
  view: CourseProgressView;
}

export interface WeakArea {
  tag: string;
  strength: number;
  cardCount: number;
  lessonIds: string[];
}

export type AppEvent =
  | { type: "course.updated"; course: CourseSummary }
  | { type: "course.deleted"; courseId: string }
  | { type: "build.started"; jobId: string; courseId: string; driver: string }
  | { type: "build.log"; jobId: string; courseId: string; entry: BuildLogEntry }
  | { type: "build.progress"; jobId: string; courseId: string; authored: number; total: number; phase: BuildPhase }
  | { type: "build.finished"; jobId: string; courseId: string; ok: boolean; error?: string }
  | { type: "progress.updated" }
  | { type: "grade.updated"; exerciseId: string; correct: boolean; score: number; feedback: string };

/* ------------------------------------------------------------------ */
/* Course setup interview                                              */
/* ------------------------------------------------------------------ */

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** What the agent settled on, ready to hand straight to api.build. */
export interface ReadyBuild {
  topic: string;
  title: string;
  level: string;
  focus?: string;
  curation: CurationMode;
  buildConfig: BuildConfig;
}

export interface InterviewReply {
  text: string;
  /** Tappable answers to the question just asked; empty when open-ended. */
  suggest: string[];
  ready?: ReadyBuild;
  driver: string;
}

/** Outcome of asking the agent to re-check a lesson. See Builder.reviseLesson. */
export interface ReviseResult {
  outcome: "corrected" | "unchanged" | "failed";
  /** Written for the learner: what was wrong, or why the lesson stands. */
  message: string;
  /** Exercises whose spaced-repetition history was dropped because they moved. */
  cardsReset: number;
}
