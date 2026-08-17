import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, BuildConfigSchema } from "@metaharness/core";
import { createApp } from "../dist/index.js";
import { ferrofluidCourse } from "../dist/seed.js";

async function bootApp() {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-ahead-"));
  const store = new Store(dir);
  await store.init();
  const course = await store.saveCourse(ferrofluidCourse());
  const app = createApp({ store, port: 0, host: "127.0.0.1" });
  const { port } = await app.listen();
  return {
    store,
    course,
    builder: app.builder,
    async cleanup() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("authorAhead defaults to writing one unit ahead, and 0 means write everything", () => {
  assert.equal(BuildConfigSchema.parse({}).authorAhead, 1);
  assert.equal(BuildConfigSchema.parse({ authorAhead: 0 }).authorAhead, 0);
  assert.equal(BuildConfigSchema.parse({ authorAhead: 3 }).authorAhead, 3);
});

/**
 * ensureAuthoredAhead runs after *every* completed lesson. If it spawned an
 * agent whenever there was nothing to do, the cost this change exists to remove
 * would come straight back.
 */
test("the write-ahead trigger starts nothing when every lesson is already written", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const before = ctx.builder.listJobs().length;
  await ctx.builder.ensureAuthoredAhead(ctx.course.id);
  assert.equal(ctx.builder.listJobs().length, before, "a fully written course needs no job");
});

test("the write-ahead trigger stays out of the way when authorAhead is 0", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  // Leave a unit unwritten, but opt out of lazy authoring entirely.
  await ctx.store.updateCourse(ctx.course.id, (c) => ({
    ...c,
    buildConfig: { ...c.buildConfig, authorAhead: 0 },
    units: c.units.map((u, i) =>
      i === c.units.length - 1 ? { ...u, lessons: u.lessons.map((l) => ({ ...l, authored: false, exercises: [] })) } : u,
    ),
  }));

  const before = ctx.builder.listJobs().length;
  await ctx.builder.ensureAuthoredAhead(ctx.course.id);
  assert.equal(ctx.builder.listJobs().length, before, "authorAhead 0 opts out of writing ahead");
});

test("a course still being planned is left alone", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  await ctx.store.updateCourse(ctx.course.id, (c) => ({
    ...c,
    status: "planning",
    units: c.units.map((u) => ({ ...u, lessons: u.lessons.map((l) => ({ ...l, authored: false, exercises: [] })) })),
  }));

  const before = ctx.builder.listJobs().length;
  await ctx.builder.ensureAuthoredAhead(ctx.course.id);
  assert.equal(ctx.builder.listJobs().length, before, "nothing to write ahead of until there is a plan");
});
