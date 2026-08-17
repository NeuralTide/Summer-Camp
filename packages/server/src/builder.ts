import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  authoredLessons,
  BuildConfigSchema,
  CurationModeSchema,
  findLesson,
  lessonSequence,
  prefixedId,
  shortId,
  slugify,
  summarize,
  totalLessons,
  type BuildConfig,
  type Course,
  type CourseLevel,
  type CurationMode,
  type Exercise,
  type Store,
} from "@metaharness/core";
import {
  DriverRegistry,
  prepareWorkspace,
  type HarnessEvent,
  type McpServerSpec,
} from "@metaharness/harness";
import type { AppEvent, BuildLogEntry, BuildPhase, EventBus } from "./bus.js";
import {
  AUTHOR_SYSTEM_PROMPT,
  INTERVIEW_SYSTEM_PROMPT,
  allowedToolsFor,
  authorLessonsPrompt,
  chatReplyPrompt,
  researchAndPlanPrompt,
  reviseLessonPrompt,
  type ChatTurn,
} from "./prompts.js";

/** Path to the MCP server entrypoint, resolved relative to this file. */
const MCP_ENTRY = fileURLToPath(new URL("../../mcp/dist/index.js", import.meta.url));

export interface BuildRequest {
  topic: string;
  level: CourseLevel;
  focus?: string;
  driver?: string;
  /** Overrides AppConfig.effort for this build only. */
  effort?: string;
  /** Overrides AppConfig.model for this build only. Empty string means "the
   *  CLI's own default"; undefined means "fall back to the global setting". */
  model?: string;
  curation: CurationMode;
  buildConfig: BuildConfig;
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
  cancel(): void;
}

const STAGE_TIMEOUT_MS = {
  plan: 12 * 60 * 1000,
  author: 20 * 60 * 1000,
  /** One lesson, and the learner is watching a spinner for it. */
  revise: 5 * 60 * 1000,
} as const;

export type ReviseOutcome = "corrected" | "unchanged" | "failed";

export interface ReviseResult {
  outcome: ReviseOutcome;
  /** Addressed to the learner: what was wrong, or why the lesson stands. */
  message: string;
  /** Exercises whose SRS history was discarded because their content moved. */
  cardsReset: number;
}

/**
 * Identity of an exercise's *content*, ignoring its id.
 *
 * Used to tell a genuinely rewritten exercise from one the agent left alone
 * while rewriting its neighbours. Keys are sorted because two objects that a
 * reader would call identical can serialise differently on key order alone,
 * and that would reset a card for no reason.
 */
function exerciseFingerprint(exercise: Exercise): string {
  const seen = new WeakSet<object>();
  const stable = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value as object)) return null;
    seen.add(value as object);
    if (Array.isArray(value)) return value.map(stable);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== "id")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  };
  return JSON.stringify(stable(exercise));
}

/** Short, because someone is sitting there waiting for the reply. */
const INTERVIEW_TIMEOUT_MS = 90 * 1000;

export interface InterviewReply {
  /** The agent's prose, with the control block stripped out. */
  text: string;
  /** Tappable replies for the question just asked, if it offered any. */
  suggest: string[];
  /** Present once the interview has settled on something to build. */
  ready?: BuildRequest & { title: string };
  driver: string;
}

/**
 * Pulls the trailing ```metaharness block out of a reply.
 *
 * Tolerant on purpose. The block is the agent's side of a contract it was
 * told about in prose, so it will occasionally be missing, fenced with the
 * wrong tag, or trailed by a stray sentence. A malformed block costs the
 * learner nothing — they lose the tappable replies for one turn — whereas
 * throwing would end the conversation over a formatting slip.
 */
export function parseControlBlock(raw: string): { text: string; suggest: string[]; ready?: BuildRequest & { title: string } } {
  const fence = /```(?:metaharness|json)?\s*(\{[\s\S]*?\})\s*```/g;
  let payload: Record<string, unknown> | undefined;
  let stripped = raw;

  for (const match of raw.matchAll(fence)) {
    const parsed = ((): Record<string, unknown> | undefined => {
      try {
        const value = JSON.parse(match[1]!);
        return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    })();
    // Last valid block wins: if the agent narrated an example before its real
    // one, the real one is the one it finished on.
    if (parsed && ("suggest" in parsed || "ready" in parsed)) payload = parsed;
    stripped = stripped.replace(match[0], "");
  }

  const text = stripped.trim();
  const suggest = Array.isArray(payload?.suggest)
    ? payload.suggest.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 4)
    : [];

  const ready = payload?.ready;
  if (!ready || typeof ready !== "object") return { text, suggest };

  const candidate = ready as Record<string, unknown>;
  const topic = typeof candidate.topic === "string" ? candidate.topic.trim() : "";
  if (!topic) return { text, suggest };

  // Re-validated rather than trusted: these numbers become hard build limits,
  // and the agent is producing them as free-form JSON.
  const shape = z.object({
    topic: z.string().trim().min(2).max(300),
    title: z.string().trim().min(2).max(140).optional(),
    level: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
    focus: z.string().trim().max(500).optional(),
    curation: CurationModeSchema.default("auto"),
    buildConfig: BuildConfigSchema.default({}),
  });
  const checked = shape.safeParse(candidate);
  if (!checked.success) return { text, suggest };

  return {
    text,
    suggest,
    ready: { ...checked.data, title: checked.data.title ?? checked.data.topic },
  };
}

export class Builder {
  private jobs = new Map<string, BuildJob>();

  constructor(
    private readonly store: Store,
    private readonly bus: EventBus,
    private readonly registry: DriverRegistry,
    /** Resolved lazily: the port is not known until the server has bound. */
    private readonly apiBase: () => string,
    private readonly token: string,
  ) {}

  listJobs(): Array<Omit<BuildJob, "cancel">> {
    return [...this.jobs.values()]
      .map(({ cancel: _cancel, ...job }) => job)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  getJob(id: string): BuildJob | undefined {
    return this.jobs.get(id);
  }

  jobForCourse(courseId: string): BuildJob | undefined {
    return [...this.jobs.values()].find((j) => j.courseId === courseId && j.phase !== "done" && j.phase !== "failed");
  }

  /**
   * One turn of the setup interview.
   *
   * Runs without MCP and with an empty tool allowlist: this agent is talking,
   * not writing, and the course does not exist yet for it to write to. That
   * also keeps the turn fast, since there are no servers to spin up.
   *
   * requireMcp is still true when resolving, because the driver picked here is
   * the one that will author the course afterwards — better to fail during a
   * conversation than after it.
   */
  async interview(
    turns: ChatTurn[],
    overrides: { driver?: string; model?: string; effort?: string } = {},
  ): Promise<InterviewReply> {
    const config = this.store.getConfig();
    const { driver } = await this.registry.resolve(overrides.driver ?? config.driver, { requireMcp: true });
    const model = overrides.model ?? config.model;
    const effort = overrides.effort ?? config.effort;

    const result = await driver.run({
      prompt: chatReplyPrompt(turns),
      systemPrompt: INTERVIEW_SYSTEM_PROMPT,
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      allowedTools: [],
      timeoutMs: INTERVIEW_TIMEOUT_MS,
    });

    if (!result.ok) throw new Error(result.error ?? `${driver.name} failed to reply.`);
    return { ...parseControlBlock(result.text), driver: driver.id };
  }

  /**
   * Re-check one lesson against a learner's objection, and rewrite it if the
   * objection is right.
   *
   * This is the thing a hosted course generator structurally cannot offer: the
   * agent is already on this machine and the course is a file on disk, so a
   * reported error can be verified and repaired in place instead of being
   * filed against a vendor.
   *
   * Runs in the foreground. It is one lesson, the learner is waiting on the
   * answer, and unlike a build there is nothing useful to show them in the
   * meantime.
   */
  async reviseLesson(courseId: string, lessonId: string, objection: string): Promise<ReviseResult> {
    const course = this.store.getCourse(courseId);
    if (!course) throw new Error("Unknown course.");
    const found = findLesson(course, lessonId);
    if (!found) throw new Error("Unknown lesson.");
    if (!found.lesson.authored) throw new Error("That lesson has not been written yet.");

    const config = this.store.getConfig();
    const { driver } = await this.registry.resolve(config.driver, { requireMcp: true });
    const mcpServers = this.mcpServers(courseId);
    const workDir = await prepareWorkspace(join(this.store.dir, "work", courseId), driver.id, mcpServers);
    const hasWebSearch = driver.id === "claude";

    // Content identity before the run, so a rewrite can be told from a no-op
    // exercise-by-exercise rather than by trusting the agent's own account.
    const before = new Map(found.lesson.exercises.map((e) => [e.id, exerciseFingerprint(e)]));

    const result = await driver.run({
      prompt: reviseLessonPrompt({
        course,
        unitTitle: found.unit.title,
        lesson: found.lesson,
        objection,
        hasWebSearch,
      }),
      systemPrompt: AUTHOR_SYSTEM_PROMPT,
      ...(config.model ? { model: config.model } : {}),
      ...(config.effort ? { effort: config.effort } : {}),
      cwd: workDir,
      mcpServers,
      allowedTools: allowedToolsFor("revise", hasWebSearch),
      timeoutMs: STAGE_TIMEOUT_MS.revise,
    });

    if (!result.ok) {
      return { outcome: "failed", message: result.error ?? `${driver.name} could not check this lesson.`, cardsReset: 0 };
    }

    const after = findLesson(this.store.getCourse(courseId)!, lessonId);
    const wrote = after ? this.lessonChanged(before, after.lesson.exercises, found.lesson.notes, after.lesson.notes) : false;
    const changed = wrote && after ? await this.resetMovedCards(before, after.lesson.exercises) : 0;

    const reply = result.text.trim();
    const declined = /^UNCHANGED\b/i.test(reply);
    const message = reply.replace(/^(CORRECTED|UNCHANGED)\s*:?\s*/i, "").split("\n")[0]?.trim() ?? "";

    if (wrote) {
      this.bus.emit({ type: "course.updated", course: summarize(this.store.getCourse(courseId)!) });
      return {
        outcome: "corrected",
        message: message || "The lesson has been corrected.",
        cardsReset: changed,
      };
    }

    return {
      // The agent said it corrected something but nothing in the lesson moved.
      // Report what actually happened rather than what it claimed.
      outcome: "unchanged",
      message:
        message ||
        (declined ? "The lesson looks right as written." : "No change was made to this lesson."),
      cardsReset: 0,
    };
  }

  /** True if the notes or any exercise differs from the pre-run snapshot. */
  private lessonChanged(
    before: Map<string, string>,
    after: Exercise[],
    notesBefore: string,
    notesAfter: string,
  ): boolean {
    if (notesBefore !== notesAfter) return true;
    if (before.size !== after.length) return true;
    return after.some((e) => before.get(e.id) !== exerciseFingerprint(e));
  }

  /**
   * Discard the spaced-repetition history of every exercise whose content moved.
   *
   * A card records how well the learner remembers *an exercise*, and SM-2 reads
   * that history to decide when to show it again. If the exercise has been
   * rewritten underneath it — or deleted — the history describes something that
   * no longer exists, and a card scheduled six weeks out would keep the
   * corrected version away for six weeks. Dropping the card entirely puts the
   * new wording back in the rotation as unseen, which is what it is.
   */
  private async resetMovedCards(before: Map<string, string>, after: Exercise[]): Promise<number> {
    const now = new Map(after.map((e) => [e.id, exerciseFingerprint(e)]));
    const moved = [...before].filter(([id, fp]) => now.get(id) !== fp).map(([id]) => id);
    // Only the ones the learner had actually answered have a card to drop, and
    // only those are worth reporting back as lost progress.
    const cards = this.store.getProgress().cards;
    const stale = moved.filter((id) => cards[id]);
    if (stale.length === 0) return 0;

    await this.store.updateProgress((p) => {
      const next = { ...p.cards };
      for (const id of stale) delete next[id];
      return { ...p, cards: next };
    });
    this.bus.emit({ type: "progress.updated" });
    return stale.length;
  }

  /**
   * Create the course shell immediately and return, then build it in the
   * background. The UI navigates to a live build screen straight away rather than
   * waiting minutes on a request.
   */
  async start(request: BuildRequest): Promise<{ job: Omit<BuildJob, "cancel">; course: Course }> {
    const config = this.store.getConfig();
    const driverId = request.driver ?? config.driver;
    // Resolve before creating anything, so a missing CLI fails loudly and early.
    const { driver } = await this.registry.resolve(driverId, { requireMcp: true });

    const now = new Date().toISOString();
    const id = prefixedId("crs");
    const course: Course = {
      id,
      slug: this.store.uniqueSlug(slugify(request.topic)),
      title: request.topic,
      topic: request.topic,
      description: "",
      level: request.level,
      status: "planning",
      curation: request.curation,
      buildConfig: request.buildConfig,
      color: "#58cc02",
      units: [],
      sources: [],
      researchNotes: "",
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.store.saveCourse(course);
    this.bus.emit({ type: "course.updated", course: summarize(saved) });

    const controller = new AbortController();
    const job: BuildJob = {
      id: prefixedId("job"),
      courseId: id,
      courseTitle: request.topic,
      phase: "starting",
      driver: driver.id,
      startedAt: now,
      log: [],
      authored: 0,
      total: 0,
      cancel: () => controller.abort(),
    };
    this.jobs.set(job.id, job);
    this.bus.emit({ type: "build.started", jobId: job.id, courseId: id, driver: driver.id });

    void this.run(job, request, driver.id, controller.signal).catch(async (err) => {
      await this.failJob(job, (err as Error).message);
    });

    const { cancel: _cancel, ...jobView } = job;
    return { job: jobView, course: saved };
  }

  private log(job: BuildJob, level: BuildLogEntry["level"], message: string, worker?: number): void {
    const entry: BuildLogEntry = {
      at: new Date().toISOString(),
      level,
      message,
      ...(worker === undefined ? {} : { worker }),
    };
    job.log.push(entry);
    if (job.log.length > 500) job.log.shift();
    this.bus.emit({ type: "build.log", jobId: job.id, courseId: job.courseId, entry });
  }

  private setPhase(job: BuildJob, phase: BuildPhase): void {
    job.phase = phase;
    this.emitProgress(job);
  }

  private emitProgress(job: BuildJob): void {
    const course = this.store.getCourse(job.courseId);
    if (course) {
      job.authored = authoredLessons(course);
      job.total = totalLessons(course);
    }
    const event: AppEvent = {
      type: "build.progress",
      jobId: job.id,
      courseId: job.courseId,
      authored: job.authored,
      total: job.total,
      phase: job.phase,
    };
    this.bus.emit(event);
  }

  private mcpServers(courseId: string): Record<string, McpServerSpec> {
    return {
      metaharness: {
        command: process.execPath,
        args: [MCP_ENTRY],
        env: {
          METAHARNESS_API: this.apiBase(),
          METAHARNESS_TOKEN: this.token,
          METAHARNESS_COURSE_ID: courseId,
        },
      },
    };
  }

  /** Forward driver events into the build log, keeping the noise readable. */
  private makeEventHandler(job: BuildJob, worker?: number): (event: HarnessEvent) => void {
    let textBuffer = "";
    return (event: HarnessEvent) => {
      switch (event.type) {
        case "text": {
          // Stream prose in sentence-ish chunks rather than per-token.
          textBuffer += event.text;
          if (textBuffer.length > 160 || /[.!?]\s*$/.test(textBuffer)) {
            const message = textBuffer.trim();
            textBuffer = "";
            if (message) this.log(job, "text", message, worker);
          }
          break;
        }
        case "tool": {
          const name = event.name.replace(/^mcp__metaharness__/, "");
          this.log(job, "tool", describeToolCall(name, event.input), worker);
          break;
        }
        case "tool_result": {
          if (!event.ok) this.log(job, "warn", `${event.name} failed: ${event.summary ?? ""}`, worker);
          else this.emitProgress(job);
          break;
        }
        case "error":
          this.log(job, "error", event.message, worker);
          break;
        case "usage":
          if (event.costUsd) this.log(job, "info", `Cost so far: $${event.costUsd.toFixed(3)}`, worker);
          break;
        default:
          break;
      }
    };
  }

  private async run(job: BuildJob, request: BuildRequest, driverId: string, signal: AbortSignal): Promise<void> {
    const { driver, status } = await this.registry.resolve(driverId, { requireMcp: true });
    const config = this.store.getConfig();
    const mcpServers = this.mcpServers(job.courseId);
    const workDir = await prepareWorkspace(join(this.store.dir, "work", job.courseId), driver.id, mcpServers);
    // Only Claude Code exposes a first-party web search tool to a headless run.
    // skipResearch lets the learner turn it off entirely even when it's available,
    // trading research quality for a cheaper, faster plan stage.
    const hasWebSearch = driver.id === "claude" && !request.buildConfig.skipResearch;

    this.log(job, "info", `Using ${status.name}${status.version ? ` ${status.version}` : ""}.`);

    /* ---------------------- Stage 1: research + plan ---------------------- */
    this.setPhase(job, "researching");
    this.log(job, "info", hasWebSearch ? "Researching the topic…" : "Drafting from model knowledge (no web search)…");

    const planResult = await driver.run({
      prompt: researchAndPlanPrompt({
        courseId: job.courseId,
        topic: request.topic,
        level: request.level,
        ...(request.focus ? { focus: request.focus } : {}),
        hasWebSearch,
        buildConfig: request.buildConfig,
      }),
      systemPrompt: AUTHOR_SYSTEM_PROMPT,
      // request.model is the per-build override; config.model the global
      // default. Undefined at both levels leaves the CLI on its own default.
      ...(request.model ?? config.model ? { model: request.model ?? config.model } : {}),
      ...(request.effort ?? config.effort ? { effort: request.effort ?? config.effort } : {}),
      cwd: workDir,
      mcpServers,
      allowedTools: allowedToolsFor("plan", hasWebSearch),
      timeoutMs: STAGE_TIMEOUT_MS.plan,
      signal,
      onEvent: this.makeEventHandler(job),
    });

    if (signal.aborted) return this.failJob(job, "Cancelled.");

    let course = this.store.getCourse(job.courseId);
    if (!course || course.units.length === 0) {
      const detail = planResult.error ?? "the agent finished without calling course_plan";
      return this.failJob(job, `Planning failed: ${detail}`);
    }

    this.log(job, "info", `Planned ${course.units.length} units, ${totalLessons(course)} lessons.`);

    if (course.curation === "review") {
      // "Build with me": stop here and let the learner approve or edit the
      // outline before a single lesson gets written. Approving is just the
      // existing resume() flow (author-whatever-is-unwritten), so there's no
      // separate "start authoring" codepath to maintain.
      await this.store.updateCourse(job.courseId, (c) => ({ ...c, status: "reviewing" }));
      this.bus.emit({ type: "course.updated", course: summarize(this.store.getCourse(job.courseId)!) });
      job.phase = "done";
      job.ok = true;
      job.finishedAt = new Date().toISOString();
      this.emitProgress(job);
      this.log(job, "info", "Plan ready — review it before writing lessons.");
      this.bus.emit({ type: "build.finished", jobId: job.id, courseId: job.courseId, ok: true });
      return;
    }

    await this.store.updateCourse(job.courseId, (c) => ({ ...c, status: "authoring" }));
    this.bus.emit({ type: "course.updated", course: summarize(this.store.getCourse(job.courseId)!) });

    /* ------------------- Stage 2: author lessons in parallel ------------------- */
    this.setPhase(job, "authoring");
    await this.authorPass(
      job,
      driver.id,
      request.model ?? config.model,
      request.effort ?? config.effort,
      mcpServers,
      workDir,
      signal,
      config.authorConcurrency,
    );

    if (signal.aborted) return this.failJob(job, "Cancelled.");

    // One retry for whatever the first pass missed — a worker that hits its timeout
    // or garbles a write should not cost the whole course.
    course = this.store.getCourse(job.courseId)!;
    if (authoredLessons(course) < totalLessons(course)) {
      const missing = totalLessons(course) - authoredLessons(course);
      this.log(job, "warn", `${missing} lesson(s) unwritten — retrying those.`);
      await this.authorPass(
        job,
        driver.id,
        request.model ?? config.model,
        request.effort ?? config.effort,
        mcpServers,
        workDir,
        signal,
        Math.min(2, config.authorConcurrency),
      );
    }

    /* ------------------------------ Finish ------------------------------ */
    this.setPhase(job, "finishing");
    course = this.store.getCourse(job.courseId)!;
    const written = authoredLessons(course);
    const total = totalLessons(course);

    if (written === 0) {
      return this.failJob(job, "No lessons could be written.");
    }

    const finalStatus = "ready";
    await this.store.updateCourse(job.courseId, (c) => {
      const next: Course = { ...c, status: finalStatus };
      delete next.error;
      return next;
    });

    job.phase = "done";
    job.ok = true;
    job.finishedAt = new Date().toISOString();
    this.emitProgress(job);
    this.log(
      job,
      "info",
      written === total
        ? `Course ready — ${total} lessons.`
        : `Course ready with ${written} of ${total} lessons; the rest stay locked.`,
    );
    this.bus.emit({ type: "course.updated", course: summarize(this.store.getCourse(job.courseId)!) });
    this.bus.emit({ type: "build.finished", jobId: job.id, courseId: job.courseId, ok: true });
  }

  /** Split unwritten lessons across N concurrent agent runs. */
  private async authorPass(
    job: BuildJob,
    driverId: string,
    /** Empty or undefined leaves the CLI on its own default model. */
    model: string | undefined,
    /** Empty or undefined leaves the CLI on its own default effort. */
    effort: string | undefined,
    mcpServers: Record<string, McpServerSpec>,
    workDir: string,
    signal: AbortSignal,
    concurrency: number,
  ): Promise<void> {
    const course = this.store.getCourse(job.courseId);
    if (!course) return;

    const pending = lessonSequence(course).filter((e) => !e.lesson.authored);
    if (pending.length === 0) return;

    const workers = Math.max(1, Math.min(concurrency, pending.length));
    const buckets: Array<typeof pending> = Array.from({ length: workers }, () => []);
    // Deal round-robin so each worker gets a spread of the course rather than one
    // worker taking every hard late-unit lesson.
    pending.forEach((entry, i) => buckets[i % workers]!.push(entry));

    const outline = lessonSequence(course)
      .map((e) => `  ${e.unit.title} › ${e.lesson.title}${e.lesson.authored ? " (written)" : ""}`)
      .join("\n");

    const { driver } = await this.registry.resolve(driverId, { requireMcp: true });
    this.log(job, "info", `Writing ${pending.length} lessons across ${workers} parallel worker(s).`);

    await Promise.all(
      buckets.map(async (bucket, index) => {
        if (bucket.length === 0 || signal.aborted) return;
        const worker = index + 1;
        const result = await driver.run({
          prompt: authorLessonsPrompt({
            course,
            outline,
            worker,
            totalWorkers: workers,
            lessons: bucket.map((e) => ({
              id: e.lesson.id,
              unitTitle: e.unit.title,
              title: e.lesson.title,
              objective: e.lesson.objective,
              kind: e.lesson.kind,
            })),
          }),
          systemPrompt: AUTHOR_SYSTEM_PROMPT,
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          cwd: workDir,
          mcpServers,
          allowedTools: allowedToolsFor("author", false),
          timeoutMs: STAGE_TIMEOUT_MS.author,
          signal,
          onEvent: this.makeEventHandler(job, worker),
        });
        if (!result.ok && !signal.aborted) {
          this.log(job, "warn", `Worker ${worker} ended early: ${result.error ?? "unknown error"}`, worker);
        }
        this.emitProgress(job);
      }),
    );

    this.bus.emit({ type: "course.updated", course: summarize(this.store.getCourse(job.courseId)!) });
  }

  private async failJob(job: BuildJob, message: string): Promise<void> {
    job.phase = "failed";
    job.ok = false;
    job.error = message;
    job.finishedAt = new Date().toISOString();
    this.log(job, "error", message);

    const course = this.store.getCourse(job.courseId);
    if (course) {
      // Keep a partially-built course playable rather than discarding the work.
      const salvageable = authoredLessons(course) > 0;
      await this.store.updateCourse(job.courseId, (c) => ({
        ...c,
        status: salvageable ? "ready" : "failed",
        error: message,
      }));
      this.bus.emit({ type: "course.updated", course: summarize(this.store.getCourse(job.courseId)!) });
    }

    this.bus.emit({ type: "build.finished", jobId: job.id, courseId: job.courseId, ok: false, error: message });
  }

  /** Author only the lessons that are still stubs, for an existing course. */
  async resume(courseId: string, driverId?: string): Promise<Omit<BuildJob, "cancel">> {
    const course = this.store.getCourse(courseId);
    if (!course) throw new Error("Course not found.");
    if (authoredLessons(course) >= totalLessons(course)) throw new Error("Every lesson is already written.");

    const config = this.store.getConfig();
    const { driver } = await this.registry.resolve(driverId ?? config.driver, { requireMcp: true });

    const controller = new AbortController();
    const job: BuildJob = {
      id: prefixedId("job"),
      courseId,
      courseTitle: course.title,
      phase: "authoring",
      driver: driver.id,
      startedAt: new Date().toISOString(),
      log: [],
      authored: authoredLessons(course),
      total: totalLessons(course),
      cancel: () => controller.abort(),
    };
    this.jobs.set(job.id, job);
    this.bus.emit({ type: "build.started", jobId: job.id, courseId, driver: driver.id });

    void (async () => {
      try {
        // Explicit rather than implicit: this is also the "approve the
        // reviewed/hand-built outline and start writing" action, so the
        // course needs to visibly move off "reviewing" the moment the job
        // starts, not just once it finishes.
        await this.store.updateCourse(courseId, (c) => ({ ...c, status: "authoring" }));
        this.bus.emit({ type: "course.updated", course: summarize(this.store.getCourse(courseId)!) });

        const mcpServers = this.mcpServers(courseId);
        const workDir = await prepareWorkspace(join(this.store.dir, "work", courseId), driver.id, mcpServers);
        await this.authorPass(
          job,
          driver.id,
          config.model,
          config.effort,
          mcpServers,
          workDir,
          controller.signal,
          config.authorConcurrency,
        );
        await this.store.updateCourse(courseId, (c) => ({ ...c, status: "ready" }));
        job.phase = "done";
        job.ok = true;
        job.finishedAt = new Date().toISOString();
        this.emitProgress(job);
        this.bus.emit({ type: "course.updated", course: summarize(this.store.getCourse(courseId)!) });
        this.bus.emit({ type: "build.finished", jobId: job.id, courseId, ok: true });
      } catch (err) {
        await this.failJob(job, (err as Error).message);
      }
    })();

    const { cancel: _cancel, ...view } = job;
    return view;
  }
}

/** Turn a raw tool call into a line worth showing a human. */
function describeToolCall(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, any>;
  switch (name) {
    case "course_plan": {
      const units = Array.isArray(args.units) ? args.units.length : 0;
      const lessons = Array.isArray(args.units)
        ? args.units.reduce((n: number, u: any) => n + (u.lessons?.length ?? 0), 0)
        : 0;
      return `Planning ${units} units, ${lessons} lessons`;
    }
    case "lesson_write": {
      const count = Array.isArray(args.exercises) ? args.exercises.length : 0;
      return `Writing lesson with ${count} exercises`;
    }
    case "research_note":
      return `Recording research (${String(args.notes ?? "").length} chars, ${args.sources?.length ?? 0} sources)`;
    case "course_get":
      return "Reading the course plan";
    case "WebSearch":
      return `Searching: ${args.query ?? ""}`;
    case "WebFetch":
      return `Reading: ${args.url ?? ""}`;
    default:
      return name;
  }
}

export { shortId };
