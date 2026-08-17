import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, dayKey } from "@metaharness/core";
import { createApp } from "../dist/index.js";
import { ferrofluidCourse } from "../dist/seed.js";

async function bootApp() {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-dailyxp-"));
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

/**
 * The "Today" ring on the course rail reads progress.dailyXp[today]. It has to
 * agree with the total XP the session actually paid out, or the daily goal
 * fills from XP the learner was never given.
 */
test("a practice session adds the same XP to the daily total as to the lifetime total", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  // Play one lesson first so there are reviewable cards to practise against.
  const lesson = await ctx.call("POST", "/api/sessions", { courseId: ctx.course.id, lessonId: ctx.course.units[0].lessons[0].id });
  for (const ex of lesson.body.session.exercises) {
    await ctx.call("POST", `/api/sessions/${lesson.body.session.id}/answer`, {
      exerciseId: ex.id,
      answer: answerFor(ex),
    });
  }
  await ctx.call("POST", `/api/sessions/${lesson.body.session.id}/complete`);

  const today = dayKey();
  const before = ctx.store.getProgress();
  const xpBefore = before.xp;
  const dailyBefore = before.dailyXp[today] ?? 0;

  const practice = await ctx.call("POST", "/api/sessions", { courseId: ctx.course.id, kind: "practice" });
  assert.equal(practice.status, 200, "practice session should start");
  for (const ex of practice.body.session.exercises) {
    await ctx.call("POST", `/api/sessions/${practice.body.session.id}/answer`, {
      exerciseId: ex.id,
      answer: answerFor(ex),
    });
  }
  const done = await ctx.call("POST", `/api/sessions/${practice.body.session.id}/complete`);
  assert.equal(done.status, 200);

  const after = ctx.store.getProgress();
  const xpDelta = after.xp - xpBefore;
  const dailyDelta = (after.dailyXp[today] ?? 0) - dailyBefore;

  assert.equal(xpDelta, done.body.xpAwarded, "lifetime XP should match what the session reported");
  assert.equal(
    dailyDelta,
    xpDelta,
    `daily XP drifted from lifetime XP: daily +${dailyDelta}, lifetime +${xpDelta}`,
  );
});

/** Answer each exercise correctly, whatever its type. */
function answerFor(ex) {
  switch (ex.type) {
    case "multiple_choice": return { kind: "choice", value: ex.choices[0] };
    case "multi_select": return { kind: "choices", values: [] };
    case "true_false": return { kind: "boolean", value: true };
    case "fill_blank": return { kind: "blanks", values: (ex.blanks ?? [{}]).map(() => "") };
    case "match_pairs": return { kind: "pairs", values: [] };
    case "order_sequence": return { kind: "order", values: ex.items ?? [] };
    case "categorize": return { kind: "categorize", values: [] };
    case "short_answer": return { kind: "text", value: "an answer" };
    case "flashcard": return { kind: "selfRated", value: "good" };
    default: return { kind: "text", value: "" };
  }
}
