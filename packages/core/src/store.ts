import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CourseSchema, formatZodError, type Course } from "./schema.js";
import { emptyProgress, settleHearts, type Progress } from "./progress.js";
import { shortId } from "./ids.js";

/**
 * Content lives as one JSON file per course on disk, and progress in a single JSON
 * file. Keeping courses as plain files is deliberate: a harness with no MCP support
 * at all can still author a course by writing a file, and courses stay diffable,
 * hand-editable, and shareable.
 */

export interface AppConfig {
  /** Driver id used to author courses, e.g. "claude" | "codex". */
  driver: string;
  /**
   * Model the driver should run, in that CLI's own spelling ("opus",
   * "sonnet", "gpt-5"). Empty leaves the CLI on its default. Deliberately a
   * free string rather than an enum: metaharness never talks to a provider,
   * so which names are valid is the installed CLI's business, and a fixed
   * list here would go stale the moment one of them shipped a new model.
   */
  model: string;
  /**
   * Reasoning effort in the driver CLI's own vocabulary — Claude Code takes
   * low/medium/high/xhigh/max, Codex low/medium/high, and the rest have no such
   * setting. Free string for the same reason as `model`, and ignored by any
   * driver whose CLI has no equivalent.
   */
  effort: string;
  /** Extra args appended to the driver invocation. */
  driverArgs: string[];
  /** Command template for the "custom" driver; `{prompt}` is substituted. */
  customCommand: string;
  /** How many lessons to author in parallel during stage 2. */
  authorConcurrency: number;
  /** Grade short answers with the model as well as the local heuristic. */
  llmGrading: boolean;
  dailyGoalXp: number;
  /** Practise without losing hearts. */
  unlimitedHearts: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  driver: "auto",
  model: "",
  effort: "",
  driverArgs: [],
  customCommand: "",
  authorConcurrency: 3,
  llmGrading: true,
  dailyGoalXp: 50,
  unlimitedHearts: false,
};

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  topic: string;
  description: string;
  level: Course["level"];
  status: Course["status"];
  color: string;
  unitCount: number;
  lessonCount: number;
  authoredCount: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export function defaultDataDir(): string {
  return process.env.METAHARNESS_DIR
    ? resolve(process.env.METAHARNESS_DIR)
    : join(homedir(), ".metaharness");
}

/** Serialises writes to a given path so concurrent authors can't interleave. */
class WriteQueue {
  private chains = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${shortId(6)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export class Store {
  readonly dir: string;
  readonly coursesDir: string;
  readonly progressPath: string;
  readonly configPath: string;

  private courses = new Map<string, Course>();
  private progress: Progress = emptyProgress();
  private config: AppConfig = { ...DEFAULT_CONFIG };
  private queue = new WriteQueue();
  private loaded = false;

  constructor(dir = defaultDataDir()) {
    this.dir = dir;
    this.coursesDir = join(dir, "courses");
    this.progressPath = join(dir, "progress.json");
    this.configPath = join(dir, "config.json");
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    await mkdir(this.coursesDir, { recursive: true });

    if (existsSync(this.progressPath)) {
      try {
        this.progress = { ...emptyProgress(), ...JSON.parse(await readFile(this.progressPath, "utf8")) };
      } catch {
        // A corrupt progress file must never brick the app; start fresh but keep the old one.
        await rename(this.progressPath, `${this.progressPath}.corrupt-${Date.now()}`).catch(() => {});
        this.progress = emptyProgress();
      }
    }

    if (existsSync(this.configPath)) {
      try {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(await readFile(this.configPath, "utf8")) };
      } catch {
        this.config = { ...DEFAULT_CONFIG };
      }
    }

    const files = (await readdir(this.coursesDir)).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = JSON.parse(await readFile(join(this.coursesDir, file), "utf8"));
        const parsed = CourseSchema.safeParse(raw);
        if (parsed.success) {
          this.courses.set(parsed.data.id, parsed.data);
        } else {
          console.warn(`[store] skipping invalid course ${file}:\n${formatZodError(parsed.error)}`);
        }
      } catch (err) {
        console.warn(`[store] skipping unreadable course ${file}: ${(err as Error).message}`);
      }
    }

    this.loaded = true;
  }

  /* --------------------------- courses --------------------------- */

  listCourses(): CourseSummary[] {
    return [...this.courses.values()]
      .map(summarize)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getCourse(idOrSlug: string): Course | undefined {
    const byId = this.courses.get(idOrSlug);
    if (byId) return byId;
    return [...this.courses.values()].find((c) => c.slug === idOrSlug);
  }

  /** Slug uniqueness is what keeps two "Linear Algebra" courses from clobbering each other. */
  uniqueSlug(base: string): string {
    let slug = base;
    let n = 2;
    const taken = new Set([...this.courses.values()].map((c) => c.slug));
    while (taken.has(slug)) slug = `${base}-${n++}`;
    return slug;
  }

  async saveCourse(course: Course): Promise<Course> {
    const next: Course = { ...course, updatedAt: new Date().toISOString() };
    this.courses.set(next.id, next);
    await this.queue.run(next.id, () => writeJsonAtomic(join(this.coursesDir, `${next.slug}.json`), next));
    return next;
  }

  /**
   * Read-modify-write under the per-course lock. Parallel lesson authors all mutate
   * the same course document, so every mutation must go through here.
   */
  async updateCourse(id: string, mutate: (course: Course) => Course | Promise<Course>): Promise<Course> {
    return this.queue.run(id, async () => {
      const current = this.courses.get(id);
      if (!current) throw new Error(`course not found: ${id}`);
      const updated = { ...(await mutate(current)), updatedAt: new Date().toISOString() };
      this.courses.set(id, updated);
      await writeJsonAtomic(join(this.coursesDir, `${updated.slug}.json`), updated);
      return updated;
    });
  }

  async deleteCourse(id: string): Promise<boolean> {
    const course = this.courses.get(id);
    if (!course) return false;
    this.courses.delete(id);
    await unlink(join(this.coursesDir, `${course.slug}.json`)).catch(() => {});

    // Drop the learner's records for this course too, or progress.json grows forever.
    const lessonIds = new Set(course.units.flatMap((u) => u.lessons.map((l) => l.id)));
    await this.updateProgress((p) => ({
      ...p,
      lessons: Object.fromEntries(Object.entries(p.lessons).filter(([k]) => !lessonIds.has(k))),
      cards: Object.fromEntries(Object.entries(p.cards).filter(([, c]) => c.courseId !== id)),
      courses: Object.fromEntries(Object.entries(p.courses).filter(([k]) => k !== id)),
    }));
    return true;
  }

  /* -------------------------- progress --------------------------- */

  getProgress(now = new Date()): Progress {
    return settleHearts(this.progress, now);
  }

  async updateProgress(mutate: (progress: Progress) => Progress): Promise<Progress> {
    return this.queue.run("__progress__", async () => {
      const next = mutate(settleHearts(this.progress));
      this.progress = next;
      await writeJsonAtomic(this.progressPath, next);
      return next;
    });
  }

  /* --------------------------- config ---------------------------- */

  getConfig(): AppConfig {
    return { ...this.config };
  }

  async updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
    return this.queue.run("__config__", async () => {
      this.config = { ...this.config, ...patch };
      await writeJsonAtomic(this.configPath, this.config);
      return { ...this.config };
    });
  }
}

export function summarize(course: Course): CourseSummary {
  const lessons = course.units.flatMap((u) => u.lessons);
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    topic: course.topic,
    description: course.description,
    level: course.level,
    status: course.status,
    color: course.color,
    unitCount: course.units.length,
    lessonCount: lessons.length,
    authoredCount: lessons.filter((l) => l.authored).length,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    error: course.error,
  };
}
