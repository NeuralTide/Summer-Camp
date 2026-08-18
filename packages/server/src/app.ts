import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import {
  buildLessonSession,
  buildPracticeSession,
  BuildConfigSchema,
  courseProgress,
  CoursePlanSchema,
  CurationModeSchema,
  emptyProgress,
  ExerciseSchema,
  findLesson,
  formatZodError,
  gradeExercise,
  LessonWriteSchema,
  msToNextHeart,
  newCard,
  PlanUnitSchema,
  prefixedId,
  refillHearts,
  reviewCard,
  RULES,
  settleHearts,
  shortId,
  ClaimSchema,
  gradeSupport,
  locateProse,
  locateQuote,
  prepareDocument,
  proseBlocks,
  provenanceKey,
  slugify,
  SourceSchema,
  summarize,
  totalLessons,
  authoredLessons,
  weakAreas,
  loseHeart,
  completeLesson,
  awardXp,
  touchStreak,
  type Answer,
  type BlockCitation,
  type Claim,
  type Course,
  type Exercise,
  type GradeResult,
  type Store,
} from "@metaharness/core";
import { DriverRegistry } from "@metaharness/harness";
import { archiveMissing, fetchArchive } from "./archiver.js";
import { provenanceFixture } from "./fixture.js";
import { Builder } from "./builder.js";
import { EventBus } from "./bus.js";
import { enforceBuildConfig, toStoredUnits } from "./buildConfig.js";
import { Grader } from "./grader.js";
import { HttpError, Router, readJsonBody, sendJson, serveStatic, type RequestContext } from "./http.js";
import { SessionRegistry } from "./sessions.js";

export interface AppOptions {
  store: Store;
  port: number;
  host: string;
  uiRoot?: string;
  token?: string;
}

export interface App {
  server: Server;
  bus: EventBus;
  builder: Builder;
  token: string;
  listen(): Promise<{ port: number; url: string }>;
  close(): Promise<void>;
}

const AnswerSchema: z.ZodType<Answer> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice"), value: z.string() }),
  z.object({ kind: z.literal("choices"), values: z.array(z.string()) }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
  z.object({ kind: z.literal("blanks"), values: z.array(z.string()) }),
  z.object({ kind: z.literal("pairs"), values: z.array(z.object({ left: z.string(), right: z.string() })) }),
  z.object({ kind: z.literal("order"), values: z.array(z.string()) }),
  z.object({ kind: z.literal("categorize"), values: z.array(z.object({ text: z.string(), category: z.string() })) }),
  z.object({ kind: z.literal("text"), value: z.string() }),
  z.object({ kind: z.literal("selfRated"), value: z.enum(["again", "hard", "good", "easy"]) }),
]) as z.ZodType<Answer>;

/**
 * Infer through the schema's *output* type so `.default()`ed fields come back
 * required. Binding a bare `T` lets TypeScript pick the input type instead, which
 * makes every defaulted field look possibly-undefined downstream.
 */
function parse<S extends z.ZodTypeAny>(schema: S, value: unknown, what: string): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, `Invalid ${what}`, formatZodError(result.error));
  }
  return result.data;
}

export function createApp(options: AppOptions): App {
  const { store } = options;
  const token = options.token ?? shortId(32);
  const bus = new EventBus();
  const registry = new DriverRegistry(store.getConfig().customCommand);
  const sessions = new SessionRegistry();
  /**
   * The bound port is only known after listen() — `options.port` may be 0, meaning
   * "any free port". Both the MCP callback URL and the same-origin check must use
   * the real one, so they read it late rather than capturing it here.
   */
  let boundPort = options.port;
  const apiBase = () => `http://${options.host === "0.0.0.0" ? "127.0.0.1" : options.host}:${boundPort}`;
  const builder = new Builder(store, bus, registry, apiBase, token);
  const grader = new Grader(store, bus, registry);

  const router = new Router();

  /* ----------------------------- bootstrap ----------------------------- */

  router.get("/api/state", async () => {
    const progress = store.getProgress();
    return {
      courses: store.listCourses(),
      progress: publicProgress(progress),
      config: store.getConfig(),
      drivers: await registry.statuses(),
      jobs: builder.listJobs(),
      rules: RULES,
    };
  });

  router.get("/api/drivers", async () => ({ drivers: await registry.statuses() }));

  router.patch("/api/config", async ({ body }) => {
    const patch = parse(
      z
        .object({
          driver: z.string(),
          /* Free strings, not enums — see AppConfig.model. */
          model: z.string().max(120),
          effort: z.string().max(40),
          driverArgs: z.array(z.string()),
          customCommand: z.string(),
          authorConcurrency: z.number().int().min(1).max(8),
          llmGrading: z.boolean(),
          dailyGoalXp: z.number().int().min(10).max(500),
          unlimitedHearts: z.boolean(),
          devMode: z.boolean(),
        })
        .partial(),
      body,
      "config",
    );
    const config = await store.updateConfig(patch);
    if (patch.customCommand !== undefined) registry.setCustomCommand(patch.customCommand);
    if (patch.dailyGoalXp !== undefined) {
      await store.updateProgress((p) => ({ ...p, dailyGoalXp: patch.dailyGoalXp! }));
      bus.emit({ type: "progress.updated" });
    }
    return { config };
  });

  /* ------------------------------- events ------------------------------- */

  router.get("/api/events", ({ req, res }) => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 2000\n\n`);
    const unsubscribe = bus.subscribe(res);

    // Proxies and browsers drop idle streams; a periodic comment keeps it warm.
    const heartbeat = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on("close", cleanup);
    req.on("error", cleanup);
    return SENT;
  });

  /* ------------------------------ courses ------------------------------ */

  router.get("/api/courses", () => ({ courses: store.listCourses() }));

  /**
   * One turn of the setup interview. Synchronous rather than streamed over the
   * event bus: a turn is one short reply and the composer is blocked on it
   * anyway, so there is nothing for a stream to reveal early.
   */
  router.post("/api/build/chat", async ({ body }) => {
    const input = parse(
      z.object({
        messages: z
          .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(8000) }))
          .min(1)
          .max(40),
        driver: z.string().optional(),
        model: z.string().max(120).optional(),
        effort: z.string().max(40).optional(),
      }),
      body,
      "chat request",
    );
    try {
      return await builder.interview(input.messages, {
        ...(input.driver ? { driver: input.driver } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.effort !== undefined ? { effort: input.effort } : {}),
      });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  router.post("/api/courses/build", async ({ body }) => {
    const input = parse(
      z.object({
        topic: z.string().trim().min(2).max(300),
        level: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
        focus: z.string().trim().max(500).optional(),
        driver: z.string().optional(),
        model: z.string().max(120).optional(),
        effort: z.string().max(40).optional(),
        curation: CurationModeSchema.default("auto"),
        buildConfig: BuildConfigSchema.default({}),
      }),
      body,
      "build request",
    );
    try {
      const { job, course } = await builder.start(input);
      return { job, course: summarize(course) };
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  router.get("/api/courses/:id", ({ params, query }) => {
    const course = requireCourse(store, params.id!);
    if (query.get("content") === "1") return course;
    // Agents planning a course need the skeleton, not every exercise already written.
    return stripContent(course);
  });

  router.delete("/api/courses/:id", async ({ params }) => {
    const course = requireCourse(store, params.id!);
    builder.jobForCourse(course.id)?.cancel();
    await store.deleteCourse(course.id);
    bus.emit({ type: "course.deleted", courseId: course.id });
    return { deleted: true };
  });

  router.post("/api/courses/:id/resume", async ({ params, body }) => {
    const course = requireCourse(store, params.id!);
    const input = parse(
      z
        .object({
          driver: z.string().optional(),
          /** "next" writes only the next unwritten unit; "all" writes the remainder. */
          scope: z.enum(["next", "all"]).default("next"),
        })
        .default({}),
      body ?? {},
      "resume request",
    );
    try {
      return { job: await builder.resume(course.id, { driverId: input.driver, scope: input.scope }) };
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  /* ------------------- authoring endpoints (used by MCP) ------------------- */

  router.post("/api/courses/:id/plan", async ({ params, body }) => {
    const course = requireCourse(store, params.id!);
    const rawPlan = parse(CoursePlanSchema, body, "course plan");
    const plan = enforceBuildConfig(rawPlan, course.buildConfig);

    const updated = await store.updateCourse(course.id, (current) => ({
      ...current,
      title: plan.title,
      description: plan.description,
      level: plan.level,
      color: plan.color,
      status: "authoring",
      sources: [...current.sources, ...plan.sources],
      units: toStoredUnits(plan.units),
    }));

    bus.emit({ type: "course.updated", course: summarize(updated) });
    return {
      lessons: updated.units.flatMap((u) => u.lessons.map((l) => ({ id: l.id, unit: u.title, title: l.title }))),
    };
  });

  router.post("/api/courses/manual", async ({ body }) => {
    const input = parse(
      z.object({
        title: z.string().trim().min(2).max(140),
        level: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#58cc02"),
        buildConfig: BuildConfigSchema.default({}),
        units: z.array(PlanUnitSchema).min(1),
      }),
      body,
      "manual course",
    );
    const plan = enforceBuildConfig(
      { title: input.title, description: "", level: input.level, color: input.color, units: input.units, sources: [] },
      input.buildConfig,
    );

    const now = new Date().toISOString();
    const course: Course = {
      id: prefixedId("crs"),
      slug: store.uniqueSlug(slugify(input.title)),
      title: plan.title,
      topic: plan.title,
      description: "",
      level: plan.level,
      status: "reviewing",
      curation: "manual",
      buildConfig: input.buildConfig,
      color: plan.color,
      units: toStoredUnits(plan.units),
      sources: [],
      claims: [],
      researchNotes: "",
      createdAt: now,
      updatedAt: now,
    };
    const saved = await store.saveCourse(course);
    bus.emit({ type: "course.updated", course: summarize(saved) });
    return { course: summarize(saved) };
  });

  router.patch("/api/courses/:id/outline", async ({ params, body }) => {
    const course = requireCourse(store, params.id!);
    if (course.status !== "reviewing") {
      throw new HttpError(400, `Course status is "${course.status}", not "reviewing" — the outline can't be edited right now.`);
    }
    const input = parse(
      z.object({
        title: z.string().trim().min(2).max(140).optional(),
        description: z.string().trim().max(1200).optional(),
        sources: z.array(SourceSchema).optional(),
        units: z.array(PlanUnitSchema).min(1),
      }),
      body,
      "outline",
    );
    const plan = enforceBuildConfig(
      {
        title: input.title ?? course.title,
        description: input.description ?? course.description,
        level: course.level,
        color: course.color,
        units: input.units,
        sources: input.sources ?? course.sources,
      },
      course.buildConfig,
    );

    const updated = await store.updateCourse(course.id, (current) => ({
      ...current,
      title: plan.title,
      description: plan.description,
      sources: plan.sources,
      units: toStoredUnits(plan.units),
    }));

    bus.emit({ type: "course.updated", course: summarize(updated) });
    return { course: summarize(updated) };
  });

  /**
   * Record research as *claims*: facts paired with the words in a source that
   * support them.
   *
   * Every quote is checked against the archived page before anything is stored,
   * and a claim whose quote is not there is refused. That refusal is the only
   * reason any of this is worth having — the model asserts, and the server is
   * what decides whether the assertion survives.
   */
  router.post("/api/courses/:id/research", async ({ params, body }) => {
    const course = requireCourse(store, params.id!);
    const input = parse(
      z.object({
        notes: z.string().max(20000).default(""),
        sources: z.array(SourceSchema).default([]),
        claims: z.array(ClaimSchema.omit({ id: true })).default([]),
        append: z.boolean().default(true),
      }),
      body,
      "research note",
    );

    // Sources must be on disk before a quote can be checked against them, so a
    // note that brings new sources archives them first.
    const sources = [...course.sources, ...input.sources].slice(0, course.buildConfig.maxSources);
    let archives = await store.getArchives(course.id);
    if (input.sources.length) {
      const fetched = await archiveMissing(sources, archives);
      if (fetched.length) archives = await store.saveArchives(course.id, fetched);
    }

    const byUrl = new Map(archives.filter((a) => a.ok).map((a) => [a.url, a]));
    const accepted: Claim[] = [];
    const rejected: string[] = [];
    for (const [i, claim] of input.claims.entries()) {
      const archive = byUrl.get(claim.sourceUrl);
      if (!archive) {
        rejected.push(
          `claims[${i}]: no archived copy of ${claim.sourceUrl}. Add it in "sources" on this call, or cite one of: ${[...byUrl.keys()].join(", ") || "(none archived yet)"}`,
        );
        continue;
      }
      const hit = locateQuote(archive.text, claim.quote);
      if (!hit || hit.kind !== "verbatim") {
        rejected.push(
          `claims[${i}]: that quote is not in ${claim.sourceUrl}` +
            (hit ? ` word for word (closest passage scored ${hit.score}). Quote it exactly as written.` : ". Copy the sentence exactly from the page."),
        );
        continue;
      }
      accepted.push({ ...claim, id: prefixedId("clm", 8) });
    }

    if (rejected.length) {
      throw new HttpError(400, `${rejected.length} of ${input.claims.length} claims were not supported by their source.`, rejected.join("\n"));
    }

    const updated = await store.updateCourse(course.id, (current) => ({
      ...current,
      researchNotes: input.append && current.researchNotes ? `${current.researchNotes}\n\n${input.notes}` : input.notes,
      // Soft cap: sources aren't retried content, so overshooting just gets
      // trimmed to the configured limit rather than rejected outright.
      sources,
      claims: input.append ? [...current.claims, ...accepted] : accepted,
    }));
    bus.emit({ type: "course.updated", course: summarize(updated) });
    return {
      ok: true,
      claims: updated.claims.map((c) => ({ id: c.id, text: c.text, sourceUrl: c.sourceUrl })),
      archived: archives.filter((a) => a.ok).length,
      unreadable: archives.filter((a) => !a.ok).map((a) => ({ url: a.url, failure: a.failure })),
    };
  });

  router.post("/api/courses/:id/lessons/:lessonId", async ({ params, body }) => {
    const course = requireCourse(store, params.id!);
    const lessonId = params.lessonId!;
    if (!findLesson(course, lessonId)) {
      throw new HttpError(404, `No lesson with id "${lessonId}" in this course. Call course_get for valid ids.`);
    }

    const input = parse(LessonWriteSchema, body, "lesson");
    if (input.exercises.length > course.buildConfig.maxExercisesPerLesson) {
      throw new HttpError(
        400,
        `Lesson has ${input.exercises.length} exercises, which is more than the configured limit of ${course.buildConfig.maxExercisesPerLesson}. Trim it down.`,
      );
    }

    /*
     * Every block of prose must name a claim that backs it.
     *
     * Refusing the write is the point rather than a nuisance: a lesson that
     * ships uncited paragraphs alongside cited ones teaches the reader that the
     * outline means nothing, and there is then no way to tell "we checked this
     * and it holds" from "nobody looked". Short blocks, headings, code and
     * equations are exempt because they carry no claim to check.
     *
     * Enforced only once the course actually has claims. A build with
     * `skipResearch`, and any hand-built course, has none by design — demanding
     * citations there would reject every lesson and fail the whole build over a
     * mode the learner deliberately chose. Those courses simply render without
     * provenance, which is honest: nothing was checked, and nothing claims to
     * have been.
     */
    const known = new Map(course.claims.map((c) => [c.id, c]));
    const enforceCitations = known.size > 0;
    const problems: string[] = [];
    const citations: BlockCitation[] = [];
    for (const [i, block] of input.blocks.entries()) {
      for (const claimId of block.cites) {
        if (!known.has(claimId)) {
          problems.push(`blocks[${i}].cites: no claim with id "${claimId}". Use ids returned by research_note.`);
          continue;
        }
        // Graded here rather than at read time because this is the only moment
        // the block's own text and the claim are both in hand, and because the
        // grade should describe the lesson as written — not drift later if the
        // grader is retuned.
        const claim = known.get(claimId)!;
        for (const prose of proseBlocks(block.markdown)) {
          const support = gradeSupport(prose, claim);
          citations.push({ block: provenanceKey(prose), claimId, support: support.level, score: support.score });
        }
      }
      if (block.cites.length > 0 || !enforceCitations) continue;
      const needsCite = proseBlocks(block.markdown).some((prose) => prose.length >= 40);
      if (needsCite) {
        problems.push(
          `blocks[${i}]: no citation. Every paragraph of prose needs at least one claim id in "cites" — ${JSON.stringify(block.markdown.slice(0, 60))}…`,
        );
      }
    }
    if (problems.length) {
      throw new HttpError(
        400,
        `This lesson has ${problems.length} block(s) that are not backed by a source.`,
        `${problems.join("\n")}\n\nAvailable claims:\n${
          course.claims.map((c) => `  ${c.id} — ${c.text.slice(0, 80)}`).join("\n") || "  (none — call research_note first)"
        }`,
      );
    }

    const notes = input.blocks.map((b) => b.markdown.trim()).join("\n\n");
    // Exercise ids are assigned here, not by the agent: they key SRS cards, so they
    // must be unique and stable regardless of what the model sends.
    const exercises: Exercise[] = input.exercises.map((ex) => ({ ...ex, id: prefixedId("exr", 8) }) as Exercise);

    const updated = await store.updateCourse(course.id, (current) => ({
      ...current,
      units: current.units.map((unit) => ({
        ...unit,
        lessons: unit.lessons.map((lesson) =>
          lesson.id === lessonId ? { ...lesson, notes, exercises, citations, authored: true } : lesson,
        ),
      })),
    }));

    bus.emit({ type: "course.updated", course: summarize(updated) });
    const found = findLesson(updated, lessonId)!;
    return {
      title: found.lesson.title,
      exerciseCount: exercises.length,
      remaining: totalLessons(updated) - authoredLessons(updated),
    };
  });

  router.post("/api/courses/:id/status", async ({ params, body }) => {
    const course = requireCourse(store, params.id!);
    const input = parse(
      z.object({ status: z.enum(["authoring", "ready", "failed"]), error: z.string().max(2000).optional() }),
      body,
      "status",
    );

    const updated = await store.updateCourse(course.id, (current) => {
      const next: Course = { ...current, status: input.status };
      if (input.error) next.error = input.error;
      else delete next.error;
      return next;
    });
    bus.emit({ type: "course.updated", course: summarize(updated) });
    return { status: updated.status, authored: authoredLessons(updated), total: totalLessons(updated) };
  });

  /* ------------------------------ progress ------------------------------ */

  /**
   * "This looks wrong." Verifies the objection against the lesson and rewrites
   * it if the learner is right — see Builder.reviseLesson.
   *
   * Synchronous, unlike a build: it is one lesson, it takes a minute at most,
   * and the answer is the whole point of asking.
   */
  router.post("/api/courses/:id/lessons/:lessonId/report", async ({ params, body }) => {
    const input = parse(
      z.object({ objection: z.string().trim().min(4).max(2000) }),
      body,
      "report",
    );
    requireCourse(store, params.id!);
    try {
      return await builder.reviseLesson(params.id!, params.lessonId!, input.objection);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  /**
   * Conjure the provenance fixture: one unit, one lesson, one exercise, one
   * already-archived source. Gated on the developer toggle rather than on a
   * build flag so it can be reached from a normal install without a rebuild.
   */
  router.post("/api/dev/fixture", async () => {
    if (!store.getConfig().devMode) throw new HttpError(403, "Developer mode is off.");
    const { course, archive } = provenanceFixture();
    const saved = await store.saveCourse({ ...course, slug: store.uniqueSlug(course.slug) });
    await store.saveArchives(saved.id, [archive]);
    bus.emit({ type: "course.updated", course: summarize(saved) });
    return { course: summarize(saved) };
  });

  /**
   * Fetch, archive, and hand back one source's readable text.
   *
   * The text goes back to the agent deliberately: it must quote from the copy
   * the server will check against, not from whatever its own browser tool saw.
   * A paywall, a consent wall or an A/B test between the two fetches would
   * otherwise produce quotes that are perfectly honest and still rejected.
   */
  router.post("/api/courses/:id/sources", async ({ params, body }) => {
    const course = requireCourse(store, params.id!);
    const input = parse(
      z.object({
        url: z.string().url(),
        title: z.string().trim().min(1).max(300),
        /** Characters of page text to return. The whole page by default. */
        limit: z.number().int().min(1000).max(80000).default(40000),
      }),
      body,
      "source",
    );

    const have = await store.getArchives(course.id);
    const already = have.find((a) => a.url === input.url && a.ok);
    const archive = already ?? (await fetchArchive({ title: input.title, url: input.url }));
    if (!already) await store.saveArchives(course.id, [archive]);
    if (!archive.ok) throw new HttpError(422, `Could not archive that page: ${archive.failure}`);

    if (!course.sources.some((src) => src.url === input.url)) {
      const updated = await store.updateCourse(course.id, (current) => ({
        ...current,
        sources: [...current.sources, { title: input.title, url: input.url }].slice(0, current.buildConfig.maxSources),
      }));
      bus.emit({ type: "course.updated", course: summarize(updated) });
    }

    return {
      url: archive.url,
      chars: archive.text.length,
      truncated: archive.text.length > input.limit,
      text: archive.text.slice(0, input.limit),
    };
  });

  /**
   * Build the smallest course that still exercises the real pipeline: one unit,
   * one lesson, research on.
   *
   * The point is to watch `source_add` → `research_note` → `lesson_write` run
   * against a live agent and see what the citation checks do to real model
   * output — which no fixture can show, because a fixture is written to pass.
   *
   * The limits are applied here rather than accepted from the caller. This
   * spends real usage, and a "quick test" that quietly grew to six units would
   * be the most expensive kind of convenience.
   */
  router.post("/api/dev/probe", async ({ body }) => {
    if (!store.getConfig().devMode) throw new HttpError(403, "Developer mode is off.");
    const input = parse(
      z.object({
        topic: z.string().trim().min(2).max(300),
        level: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
        driver: z.string().optional(),
        model: z.string().max(120).optional(),
        effort: z.string().max(40).optional(),
      }),
      body,
      "probe request",
    );

    try {
      const { job, course } = await builder.start({
        ...input,
        curation: "auto",
        buildConfig: BuildConfigSchema.parse({
          maxUnits: 1,
          maxLessonsPerUnit: 1,
          maxSources: 3,
          maxExercisesPerLesson: 3,
          skipResearch: false,
          authorAhead: 0,
        }),
      });
      return { job, course: summarize(course) };
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  /**
   * One turn of the lesson tutor: a question about the lesson being read.
   *
   * Deliberately stateless. The client holds the transcript and sends it back
   * each turn, which is how the interview works too — no driver here is
   * guaranteed to support resuming a session, and a conversation about one
   * lesson is small enough that resending it costs almost nothing.
   */
  router.post("/api/courses/:id/lessons/:lessonId/chat", async ({ params, body }) => {
    const course = requireCourse(store, params.id!);
    const input = parse(
      z.object({
        turns: z
          .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(8000) }))
          .min(1)
          .max(40),
        driver: z.string().optional(),
        model: z.string().max(120).optional(),
        effort: z.string().max(40).optional(),
        /** Client-generated, so a tab can pick its own reply out of the bus. */
        turnId: z.string().max(64).optional(),
      }),
      body,
      "chat request",
    );

    try {
      return await builder.lessonChat(course.id, params.lessonId!, input.turns, {
        ...(input.driver ? { driver: input.driver } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.effort !== undefined ? { effort: input.effort } : {}),
        ...(input.turnId ? { turnId: input.turnId } : {}),
      });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  /* --------------------------- source provenance --------------------------- */

  /**
   * Fetch and keep the pages this course cites.
   *
   * Separate from building on purpose: a course generated long before any of
   * this existed can be archived now and gets provenance retroactively, and
   * archiving costs nothing but bandwidth — no agent, no model, no usage.
   */
  router.post("/api/courses/:id/archive", async ({ params }) => {
    const course = requireCourse(store, params.id!);
    const have = await store.getArchives(course.id);
    const fetched = await archiveMissing(course.sources, have);
    const archives = fetched.length ? await store.saveArchives(course.id, fetched) : have;
    return {
      archived: archives.filter((a) => a.ok).length,
      failed: archives.filter((a) => !a.ok).map((a) => ({ title: a.title, url: a.url, failure: a.failure })),
      total: course.sources.length,
    };
  });

  router.get("/api/courses/:id/archives", async ({ params }) => {
    const course = requireCourse(store, params.id!);
    // Text is omitted here; it is large and only the viewer needs it.
    const archives = await store.getArchives(course.id);
    return {
      archives: archives.map(({ text, ...rest }) => ({ ...rest, length: text.length })),
    };
  });

  /** The archived page itself, for the viewer to render and highlight. */
  router.get("/api/courses/:id/archives/:sourceId", async ({ params }) => {
    const course = requireCourse(store, params.id!);
    const archive = (await store.getArchives(course.id)).find((a) => a.id === params.sourceId);
    if (!archive) throw new HttpError(404, "No archived copy of that source.");
    return archive;
  });

  /**
   * Which blocks of a lesson's notes can be found in the course's sources.
   *
   * Computed per request rather than stored: it is pure string matching over
   * text already on disk, it costs single-digit milliseconds, and caching it
   * would mean invalidating on every re-archive and every lesson revision.
   */
  /**
   * Where each block of a lesson's notes comes from.
   *
   * Two sources of truth, and they are not equal. A *cited* block was declared
   * by the author and its quote proven to exist in the archive at write time. A
   * *guessed* block is this app matching strings after the fact on a course
   * built before citations existed — useful, but an inference, and labelled as
   * one so the reader is never shown a guess dressed as a citation.
   */
  router.get("/api/courses/:id/lessons/:lessonId/provenance", async ({ params }) => {
    const course = requireCourse(store, params.id!);
    const found = findLesson(course, params.lessonId!);
    if (!found) throw new HttpError(400, "No such lesson in this course.");
    const archives = await store.getArchives(course.id);
    const claims = new Map(course.claims.map((c) => [c.id, c]));
    const byUrl = new Map(archives.map((a) => [a.url, a]));
    /*
     * Paragraph text by key, so a citation written before grading existed can be
     * graded now instead of defaulting to the humblest label.
     *
     * Grading normally happens once, at write time, so the grade describes the
     * lesson as written and cannot be silently rewritten later by a retuned
     * grader. That reasoning does not reach a citation that was never graded at
     * all: there is no recorded judgement to protect, and leaving it at the
     * schema default means a course full of real, verified citations displays as
     * if nobody had checked anything. So they are measured here, on read, and
     * every course built in the window before grading fixes itself the next time
     * a lesson is opened — with no rebuild and no model.
     */
    const proseByKey = new Map(proseBlocks(found.lesson.notes).map((prose) => [provenanceKey(prose), prose]));

    const cited = found.lesson.citations
      .flatMap((citation) => {
        const claim = claims.get(citation.claimId);
        const archive = claim ? byUrl.get(claim.sourceUrl) : undefined;
        if (!claim || !archive) return [];

        // A stored grade wins; an ungraded citation is measured from the text
        // still on disk. A grade of exactly 0 is a real measurement, so the test
        // is on the field being absent, not on it being falsy.
        const prose = proseByKey.get(citation.block);
        const graded =
          citation.support === undefined || citation.score === undefined
            ? prose
              ? (({ level, score }) => ({ support: level, score }))(gradeSupport(prose, claim))
              : { support: "asserted" as const, score: 0 }
            : { support: citation.support, score: citation.score };

        return [{
          key: citation.block,
          verified: true as const,
          claimId: claim.id,
          quote: claim.quote,
          sourceId: archive.id,
          sourceTitle: archive.title,
          sourceUrl: archive.url,
          hasDocument: Boolean(archive.html),
          // How well the paragraph's wording follows the claim. Never assumed: a
          // paragraph that merely points at a claim is a weaker thing than one
          // that quotes it, and the reader is owed the difference.
          ...graded,
        }];
      })
      // Strongest first, so a paragraph resting on several claims is represented
      // by its best-supported one rather than by whichever was listed last.
      .sort((a, b) => b.score - a.score);

    // Only fall back when the lesson declared nothing — mixing a guess into a
    // cited lesson would make the outline mean two different things at once.
    const blocks = cited.length
      ? cited
      : locateProse(found.lesson.notes, archives).map((hit) => ({
          ...hit,
          verified: false as const,
          claimId: null,
          quote: null,
          hasDocument: Boolean(byUrl.get(hit.sourceUrl)?.html),
          // A guess reports the same two fields so the viewer has one shape to
          // render; `verified: false` is what keeps the two from being confused.
          support: hit.kind === "verbatim" ? ("quoted" as const) : ("restated" as const),
        }));

    const citedKeys = new Set(blocks.map((b) => b.key));
    return {
      blocks,
      verified: cited.length > 0,
      /*
       * The denominator for "n of m paragraphs cited", and it has to count the
       * same population the numerator does or it can be exceeded — a lesson
       * citing short list items reported 8 of 5, which is the same species of
       * nonsense as double-counting a paragraph.
       *
       * A paragraph counts if it is substantial enough to need a source, OR if
       * the author vouched for it whatever its length. That keeps headings and
       * one-line connectives out of the count while keeping every marked-up
       * item in it, and makes the numerator a subset by construction.
       */
      proseCount: proseBlocks(found.lesson.notes).filter(
        (b) => b.length >= 40 || citedKeys.has(provenanceKey(b)),
      ).length,
      archived: archives.filter((a) => a.ok).length,
      sourceCount: course.sources.length,
    };
  });

  /**
   * The archived page itself, as a document — scripts stripped, assets pointed
   * back at the origin, the cited passage wrapped in <mark id="mh-cited">.
   *
   * Served as HTML rather than JSON because it is loaded into a sandboxed
   * iframe, and delivered with a fragment target so the browser scrolls to the
   * highlight without any script running inside the frame.
   */
  router.get("/api/courses/:id/archives/:sourceId/document", async ({ params, query, res }) => {
    const course = requireCourse(store, params.id!);
    const archive = (await store.getArchives(course.id)).find((a) => a.id === params.sourceId);
    if (!archive) throw new HttpError(404, "No archived copy of that source.");
    if (!archive.html) throw new HttpError(409, "This source was archived without its markup.");

    const claim = course.claims.find((c) => c.id === query.get("claim"));
    const quote = claim?.quote ?? query.get("quote") ?? undefined;
    const { html, highlighted } = prepareDocument(archive, quote ?? undefined);

    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "x-highlighted": highlighted ? "1" : "0",
      // The document is third-party markup; keep it from being framed anywhere
      // but here, and from being sniffed into something else.
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    res.end(html);
    return SENT;
  });

  router.get("/api/courses/:id/progress", () => {
    const progress = store.getProgress();
    return { progress: publicProgress(progress) };
  });

  router.get("/api/courses/:id/view", ({ params }) => {
    const course = requireCourse(store, params.id!);
    const progress = store.getProgress();
    const lessons = course.units.flatMap((u) => u.lessons);
    return {
      course: {
        ...stripContent(course),
        // stripContent/course carry the full tree but not the summary counts the
        // header bar reads (authoredCount/lessonCount/unitCount) — attach them here
        // rather than making the client re-derive what the API already knows.
        unitCount: course.units.length,
        lessonCount: lessons.length,
        authoredCount: lessons.filter((l) => l.authored).length,
        researchNotes: course.researchNotes,
        sources: course.sources,
      },
      view: courseProgress(course, progress),
      weakAreas: weakAreas(course, progress),
      job: builder.jobForCourse(course.id) ? { id: builder.jobForCourse(course.id)!.id } : null,
    };
  });

  router.post("/api/progress/refill-hearts", async () => {
    const progress = await store.updateProgress((p) => refillHearts(p));
    bus.emit({ type: "progress.updated" });
    return { progress: publicProgress(progress) };
  });

  /* ------------------------------ sessions ------------------------------ */

  router.post("/api/sessions", ({ body }) => {
    const input = parse(
      z.object({
        courseId: z.string(),
        lessonId: z.string().optional(),
        kind: z.enum(["lesson", "practice"]).default("lesson"),
      }),
      body,
      "session request",
    );
    const course = requireCourse(store, input.courseId);
    const sessionId = prefixedId("ses");

    const session =
      input.kind === "practice" || !input.lessonId
        ? buildPracticeSession(course, store.getProgress(), sessionId)
        : buildLessonSession(course, input.lessonId, sessionId);

    if (!session) {
      throw new HttpError(400, input.lessonId ? "That lesson has not been written yet." : "Nothing to practise yet.");
    }

    const active = sessions.create({
      kind: session.kind,
      courseId: course.id,
      lessonId: session.lessonId,
      exerciseIds: session.exercises.map((e) => e.id),
    });

    return { session: { ...session, id: active.id } };
  });

  router.post("/api/sessions/:sid/answer", async ({ params, body }) => {
    const active = sessions.get(params.sid!);
    if (!active) throw new HttpError(404, "Session expired. Start the lesson again.");

    const input = parse(z.object({ exerciseId: z.string(), answer: AnswerSchema }), body, "answer");
    const course = requireCourse(store, active.courseId);
    const found = findExercise(course, input.exerciseId);
    if (!found) throw new HttpError(404, "Unknown exercise.");
    const { exercise, lessonId: owningLessonId } = found;
    if (!active.exerciseIds.includes(input.exerciseId)) throw new HttpError(400, "That exercise is not in this session.");

    const result: GradeResult = gradeExercise(exercise, input.answer);

    const isRetry = active.attempted.has(input.exerciseId);
    active.attempted.add(input.exerciseId);
    if (result.correct && !isRetry) active.firstTryCorrect.add(input.exerciseId);
    if (!result.correct) active.wrongCount += 1;

    // The lesson the exercise actually belongs to, not the session's lesson: a
    // practice session has none, and this used to fall back to the *exercise*
    // id, so every card first seen during practice was persisted claiming a
    // lesson that does not exist. Practice routinely creates cards, because
    // buildPracticeSession tops a short queue up with never-seen exercises.
    const lessonId = owningLessonId;
    const config = store.getConfig();
    let heartsLeft = store.getProgress().hearts;

    await store.updateProgress((p) => {
      // Spaced-repetition state updates on every attempt, right or wrong.
      const existing = p.cards[exercise.id] ?? newCard(exercise.id, active.courseId, lessonId);
      const cards = { ...p.cards, [exercise.id]: reviewCard(existing, result.score) };
      let next = { ...p, cards };
      if (!result.correct && !config.unlimitedHearts && exercise.type !== "flashcard") {
        next = loseHeart(next);
      }
      heartsLeft = next.hearts;
      return next;
    });
    bus.emit({ type: "progress.updated" });

    // Free-text answers get a model second opinion in the background; the
    // heuristic verdict has already been returned by then.
    if (exercise.type === "short_answer" && input.answer.kind === "text") {
      grader.enqueue(exercise, input.answer.value, result);
    }

    return {
      result,
      hearts: heartsLeft,
      outOfHearts: heartsLeft <= 0 && !config.unlimitedHearts,
      explanation: exercise.explanation ?? null,
    };
  });

  router.post("/api/sessions/:sid/complete", async ({ params }) => {
    const active = sessions.get(params.sid!);
    if (!active) throw new HttpError(404, "Session expired.");
    if (active.completedAt) throw new HttpError(409, "This session was already completed.");
    active.completedAt = Date.now();

    const course = requireCourse(store, active.courseId);
    const score = sessions.score(active);
    const perfect = active.wrongCount === 0 && active.firstTryCorrect.size === active.exerciseIds.length;

    let xpAwarded = 0;
    let crownEarned = false;
    const before = store.getProgress();

    if (active.kind === "lesson" && active.lessonId) {
      const outcome = completeLesson(before, active.courseId, active.lessonId, {
        score,
        correctCount: active.firstTryCorrect.size,
        perfect,
      });
      xpAwarded = outcome.xpAwarded;
      crownEarned = outcome.crownEarned;
      await store.updateProgress(() => outcome.progress);
    } else {
      // Practice pays per card reviewed rather than per lesson completed.
      //
      // Awarded directly rather than by running completeLesson against a
      // synthetic "__practice__" lesson and correcting the total afterwards.
      // That correction only adjusted `xp` and left `dailyXp` holding whatever
      // the synthetic lesson had scored — a different number, and often zero,
      // because awardXp short-circuits on a zero amount and the synthetic
      // lesson was passed correctCount: 0. So practice XP either missed the
      // daily goal ring entirely or filled it by the wrong amount.
      //
      // awardXp moves `xp` and `dailyXp` together, which is the invariant that
      // was being broken; the streak and course timestamps are the only other
      // things completeLesson was here for, and they are set explicitly below.
      xpAwarded = active.firstTryCorrect.size * RULES.xpPerReview;
      await store.updateProgress((p) => {
        const now = new Date();
        let next = awardXp(p, xpAwarded, now);
        next = touchStreak(next, now);
        return {
          ...next,
          courses: {
            ...next.courses,
            [active.courseId]: {
              startedAt: next.courses[active.courseId]?.startedAt ?? now.toISOString(),
              lastStudiedAt: now.toISOString(),
            },
          },
        };
      });
    }

    const after = store.getProgress();
    bus.emit({ type: "progress.updated" });

    // Finishing a lesson may have brought the next unit into range. Fire and
    // forget: the authoring is for a unit the learner has not reached, and
    // nothing on this response depends on it.
    void builder.ensureAuthoredAhead(active.courseId).catch(() => {});

    return {
      score,
      perfect,
      xpAwarded,
      crownEarned,
      correctCount: active.firstTryCorrect.size,
      total: active.exerciseIds.length,
      passed: score >= RULES.passThreshold,
      progress: publicProgress(after),
      view: courseProgress(course, after),
    };
  });

  /* -------------------------------- jobs -------------------------------- */

  router.get("/api/jobs", () => ({ jobs: builder.listJobs() }));

  router.get("/api/jobs/:id", ({ params }) => {
    const job = builder.getJob(params.id!);
    if (!job) throw new HttpError(404, "No such job.");
    const { cancel: _cancel, ...view } = job;
    return { job: view };
  });

  router.post("/api/jobs/:id/cancel", ({ params }) => {
    const job = builder.getJob(params.id!);
    if (!job) throw new HttpError(404, "No such job.");
    job.cancel();
    return { cancelled: true };
  });

  /* ------------------------------- server ------------------------------- */

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message });
      else res.end();
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (url.pathname.startsWith("/api/")) {
      if (!isAllowed(req, token, boundPort)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
      }

      const match = router.match(req.method ?? "GET", url.pathname);
      if (!match) {
        sendJson(res, 404, { error: `No route for ${req.method} ${url.pathname}` });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const ctx: RequestContext = { req, res, params: match.params, query: url.searchParams, body, url };
        const result = await match.handler(ctx);
        if (result === SENT) return;
        sendJson(res, 200, result);
      } catch (err) {
        if (err instanceof HttpError) {
          sendJson(res, err.status, { error: err.message, ...(err.detail ? { detail: err.detail } : {}) });
        } else {
          sendJson(res, 500, { error: (err as Error).message });
        }
      }
      return;
    }

    if (options.uiRoot && (await serveStatic(options.uiRoot, url.pathname, res))) return;

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(
      options.uiRoot
        ? "Not found."
        : "Metaharness API is running, but the UI has not been built. Run: npm run build -w @metaharness/ui",
    );
  }

  return {
    server,
    bus,
    builder,
    token,
    listen: () =>
      new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          const address = server.address();
          boundPort = typeof address === "object" && address ? address.port : options.port;
          resolvePromise({ port: boundPort, url: `http://${options.host}:${boundPort}` });
        });
      }),
    close: () =>
      new Promise((resolvePromise) => {
        bus.closeAll();
        server.close(() => resolvePromise());
      }),
  };
}

/** Sentinel meaning "the handler already wrote the response" (SSE). */
const SENT = Symbol("response-sent") as unknown as object;

/**
 * Local-only access control. The daemon binds to loopback, but that alone does not
 * stop a web page the user is visiting from calling it, so requests must either
 * carry the MCP token or be same-origin. Checking Host as well blocks DNS
 * rebinding, where an attacker-controlled name resolves to 127.0.0.1.
 */
function isAllowed(req: IncomingMessage, token: string, port: number): boolean {
  if (req.headers["x-metaharness-token"] === token) return true;

  const host = req.headers.host ?? "";
  const hostname = host.split(":")[0] ?? "";
  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (!localHosts.has(hostname)) return false;

  const origin = req.headers.origin;
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!localHosts.has(originUrl.hostname)) return false;
      if (originUrl.port && originUrl.port !== String(port)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function requireCourse(store: Store, idOrSlug: string): Course {
  const course = store.getCourse(idOrSlug);
  if (!course) throw new HttpError(404, `No course "${idOrSlug}".`);
  return course;
}

/**
 * The exercise, plus the lesson that owns it.
 *
 * The lesson matters because an SRS card records the lesson it belongs to, and
 * a practice session has no lesson of its own — so the owner has to be resolved
 * from the course tree rather than taken from the session.
 */
function findExercise(course: Course, exerciseId: string): { exercise: Exercise; lessonId: string } | undefined {
  for (const unit of course.units) {
    for (const lesson of unit.lessons) {
      const found = lesson.exercises.find((e) => e.id === exerciseId);
      if (found) return { exercise: found, lessonId: lesson.id };
    }
  }
  return undefined;
}

/** The course tree without exercise bodies — enough to render, too little to cheat from. */
function stripContent(course: Course) {
  return {
    ...course,
    researchNotes: course.researchNotes ? `${course.researchNotes.slice(0, 400)}…` : "",
    units: course.units.map((unit) => ({
      ...unit,
      lessons: unit.lessons.map(({ exercises, notes, ...lesson }) => ({
        ...lesson,
        exerciseCount: exercises.length,
        hasNotes: notes.length > 0,
      })),
    })),
  };
}

/** Progress shaped for the client, with derived values it would otherwise recompute. */
export function publicProgress(progress = emptyProgress()) {
  const settled = settleHearts(progress);
  return {
    xp: settled.xp,
    hearts: settled.hearts,
    maxHearts: RULES.maxHearts,
    msToNextHeart: msToNextHeart(settled),
    streak: settled.streak,
    dailyGoalXp: settled.dailyGoalXp,
    dailyXp: settled.dailyXp,
    lessons: settled.lessons,
    courses: settled.courses,
    dueByCourse: Object.values(settled.cards).reduce<Record<string, number>>((acc, card) => {
      if (new Date(card.dueAt).getTime() <= Date.now()) acc[card.courseId] = (acc[card.courseId] ?? 0) + 1;
      return acc;
    }, {}),
  };
}

export { ExerciseSchema };
