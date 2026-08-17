import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@metaharness/core";
import { createApp } from "../dist/index.js";
import { ferrofluidCourse } from "../dist/seed.js";

async function bootApp() {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-srs-"));
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

/** Every exercise id in the course, mapped to the lesson that owns it. */
function ownerIndex(course) {
  const owner = new Map();
  for (const unit of course.units) {
    for (const lesson of unit.lessons) {
      for (const ex of lesson.exercises) owner.set(ex.id, lesson.id);
    }
  }
  return owner;
}

test("cards created during practice record the lesson that owns the exercise", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  // Straight into practice with no prior lesson, so every card in this session
  // is created fresh — buildPracticeSession tops the queue up with never-seen
  // exercises, which is the path that used to persist a bogus lesson id.
  const practice = await ctx.call("POST", "/api/sessions", { courseId: ctx.course.id, kind: "practice" });
  assert.equal(practice.status, 200);
  const exercises = practice.body.session.exercises;
  assert.ok(exercises.length > 0, "practice session should have exercises");

  for (const ex of exercises) {
    await ctx.call("POST", `/api/sessions/${practice.body.session.id}/answer`, {
      exerciseId: ex.id,
      answer: { kind: "text", value: "whatever" },
    });
  }

  const owner = ownerIndex(ctx.course);
  const cards = Object.values(ctx.store.getProgress().cards);
  assert.ok(cards.length > 0, "answering should have created cards");

  for (const card of cards) {
    const expected = owner.get(card.exerciseId);
    assert.ok(expected, `card ${card.exerciseId} should belong to a real exercise`);
    assert.notEqual(
      card.lessonId,
      card.exerciseId,
      "a card must not record its own exercise id as its lesson",
    );
    assert.equal(card.lessonId, expected, `card ${card.exerciseId} should point at its owning lesson`);
  }
});
