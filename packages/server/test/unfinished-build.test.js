import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, lostLessons } from "@metaharness/core";
import { createApp } from "../dist/index.js";
import { ferrofluidCourse } from "../dist/seed.js";

/**
 * Writing lessons runs a real agent CLI, so nothing here may reach that far —
 * a test that spawned an authoring session would spend the learner's usage to
 * assert something. What is reachable is everything guarding the spawn, plus
 * the bookkeeping that decides whether a course admits it stopped early.
 */
async function bootApp() {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-unfinished-"));
  const store = new Store(dir);
  await store.init();
  const course = await store.saveCourse(ferrofluidCourse());
  const app = createApp({ store, port: 0, host: "127.0.0.1" });
  const { port } = await app.listen();
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { store, course, call, async cleanup() { await app.close(); await rm(dir, { recursive: true, force: true }); } };
}

/** A course with `unwritten` lessons blanked from the end, and a recorded outcome. */
function withOutcome(course, unwritten, deferred) {
  const lessons = course.units.flatMap((u) => u.lessons);
  const blank = new Set(lessons.slice(lessons.length - unwritten).map((l) => l.id));
  return {
    ...course,
    units: course.units.map((u) => ({
      ...u,
      lessons: u.lessons.map((l) => (blank.has(l.id) ? { ...l, authored: false, exercises: [] } : l)),
    })),
    lastBuild: {
      finishedAt: new Date().toISOString(),
      written: lessons.length - unwritten,
      total: lessons.length,
      deferred,
      ok: unwritten === deferred,
      detail: "",
    },
  };
}

test("unwritten lessons only count as lost when the build did not defer them", (t) => {
  const course = ferrofluidCourse();

  // Nothing recorded: a course nobody has built is not a course that failed.
  assert.equal(lostLessons({ ...course, lastBuild: undefined }), 0);

  // Three unwritten, all of them promised to a later pass — this is the normal
  // state of a course that writes just ahead of the reader.
  assert.equal(lostLessons(withOutcome(course, 3, 3)), 0);

  // Three unwritten and none deferred: the build meant to write them and didn't.
  assert.equal(lostLessons(withOutcome(course, 3, 0)), 3);

  // Deferred one, lost two.
  assert.equal(lostLessons(withOutcome(course, 3, 1)), 2);
});

/**
 * The bug this whole change exists for: a build that lost its lessons to a
 * usage limit still finished as `ready` with `error` cleared, so the course was
 * indistinguishable from a complete one and the UI's offer to write the rest —
 * gated on a status the course never reached — could not be reached at all.
 */
test("a course that stopped early is still marked ready, but says so", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  await ctx.store.updateCourse(ctx.course.id, (c) => withOutcome(c, 3, 0));

  // The screen reads /view, so that is where the honesty has to survive to.
  const { status, body } = await ctx.call("GET", `/api/courses/${ctx.course.id}/view`);
  assert.equal(status, 200);
  const course = body.course;
  assert.equal(course.status, "ready", "a partly-written course stays playable");
  assert.ok(course.authoredCount < course.lessonCount, "and is visibly short of lessons");
  assert.equal(course.lastBuild.ok, false, "but the outcome does not claim success");
  assert.equal(course.lastBuild.deferred, 0);
  assert.equal(lostLessons(course), 3, "so the UI can tell this from writing ahead");
});

test("resume refuses a course with nothing left to write, before spawning anything", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  // The seed course is fully authored. This guard runs ahead of driver
  // resolution on purpose: the cheapest agent session is the one not started.
  const { status, body } = await ctx.call("POST", `/api/courses/${ctx.course.id}/resume`, {});
  assert.equal(status, 400);
  assert.match(body.detail ?? body.error ?? "", /already written/i);
});

test("resume rejects a scope it does not understand", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  await ctx.store.updateCourse(ctx.course.id, (c) => withOutcome(c, 3, 0));

  const { status } = await ctx.call("POST", `/api/courses/${ctx.course.id}/resume`, { scope: "everything" });
  assert.equal(status, 400, "an unknown scope must not fall through to writing the whole course");
});
