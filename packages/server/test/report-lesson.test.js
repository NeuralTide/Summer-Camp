import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@metaharness/core";
import { createApp } from "../dist/index.js";
import { ferrofluidCourse } from "../dist/seed.js";

/**
 * The revision itself runs a real agent turn, so it isn't reachable from a test.
 * What is reachable — and what protects the learner from a confusing failure —
 * is everything the endpoint refuses before it gets that far.
 */
async function bootApp() {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-report-"));
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

test("a report needs an objection with something in it", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());
  const lessonId = ctx.course.units[0].lessons[0].id;
  const path = `/api/courses/${ctx.course.id}/lessons/${lessonId}/report`;

  for (const objection of ["", "   ", "no"]) {
    const { status } = await ctx.call("POST", path, { objection });
    assert.equal(status, 400, `"${objection}" should be rejected`);
  }

  const { status } = await ctx.call("POST", path, { objection: "x".repeat(2001) });
  assert.equal(status, 400, "an objection past the cap should be rejected");
});

test("a report against a course or lesson that does not exist is refused", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());
  const objection = { objection: "The definition in the notes is backwards." };

  const missingCourse = await ctx.call("POST", "/api/courses/nope/lessons/whatever/report", objection);
  assert.equal(missingCourse.status, 404, "unknown course should 404");

  const missingLesson = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/nope/report`, objection);
  assert.equal(missingLesson.status, 400, "unknown lesson should be a bad request");
  assert.match(missingLesson.body.detail ?? missingLesson.body.error ?? "", /lesson/i);
});

test("an unwritten lesson cannot be reported", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  // Blank out a lesson so it looks like one the authoring pass never reached.
  const target = ctx.course.units[0].lessons[0].id;
  await ctx.store.updateCourse(ctx.course.id, (c) => ({
    ...c,
    units: c.units.map((u) => ({
      ...u,
      lessons: u.lessons.map((l) => (l.id === target ? { ...l, authored: false, exercises: [] } : l)),
    })),
  }));

  const { status, body } = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${target}/report`, {
    objection: "This lesson contradicts the previous one.",
  });
  assert.equal(status, 400);
  assert.match(body.detail ?? body.error ?? "", /not been written/i);
});
