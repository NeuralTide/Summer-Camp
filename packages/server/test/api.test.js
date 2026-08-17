import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@metaharness/core";
import { createApp, parseGrade } from "../dist/index.js";
import { ferrofluidCourse } from "../dist/seed.js";

async function bootApp() {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-test-"));
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

  return {
    app,
    store,
    course,
    base,
    port,
    call,
    async cleanup() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("bootstrap state exposes courses, progress and driver availability", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const { status, body } = await ctx.call("GET", "/api/state");
  assert.equal(status, 200);
  assert.equal(body.courses.length, 1);
  assert.equal(body.courses[0].title, "Ferrofluids");
  assert.equal(body.courses[0].lessonCount, 5);
  assert.equal(body.progress.hearts, 5);
  assert.ok(Array.isArray(body.drivers) && body.drivers.length > 0);
  assert.ok(body.drivers.some((d) => d.id === "claude"));
});

test("the course view never ships exercise bodies to the client", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const { body } = await ctx.call("GET", `/api/courses/${ctx.course.id}/view`);
  const lesson = body.course.units[0].lessons[0];
  assert.equal(lesson.exercises, undefined, "exercise bodies must not be in the tree payload");
  assert.ok(lesson.exerciseCount > 0, "but the count is still exposed for the UI");
  assert.equal(body.view.nodes[0].state, "available");
  assert.equal(body.view.nodes[1].state, "locked");
});

test("a full lesson playthrough grades, charges hearts, and awards XP", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const lessonId = ctx.course.units[0].lessons[0].id;
  const start = await ctx.call("POST", "/api/sessions", { courseId: ctx.course.id, lessonId });
  assert.equal(start.status, 200);
  const session = start.body.session;
  assert.equal(session.exercises.length, 5);
  assert.ok(session.notes.length > 100, "lesson notes are delivered for the teaching screen");

  // No exercise may carry its own answer key.
  for (const ex of session.exercises) {
    for (const leaked of ["answer", "answers", "blanks", "pairs", "keyPoints", "exemplar"]) {
      assert.equal(leaked in ex, false, `${ex.type} leaked "${leaked}"`);
    }
  }

  const mc = session.exercises.find((e) => e.type === "multiple_choice");
  const wrong = await ctx.call("POST", `/api/sessions/${session.id}/answer`, {
    exerciseId: mc.id,
    answer: { kind: "choice", value: mc.choices.find((c) => c !== "It stops the particles clumping together") },
  });
  assert.equal(wrong.body.result.correct, false);
  assert.equal(wrong.body.hearts, 4, "a wrong answer costs a heart");
  assert.ok(wrong.body.explanation, "the explanation is returned for the feedback panel");

  const right = await ctx.call("POST", `/api/sessions/${session.id}/answer`, {
    exerciseId: mc.id,
    answer: { kind: "choice", value: "It stops the particles clumping together" },
  });
  assert.equal(right.body.result.correct, true);
  assert.equal(right.body.hearts, 4, "a correct answer does not refund the heart");

  const done = await ctx.call("POST", `/api/sessions/${session.id}/complete`, {});
  assert.equal(done.status, 200);
  assert.equal(done.body.total, 5);
  assert.equal(done.body.correctCount, 0, "a retry does not count as first-try correct");
  assert.equal(done.body.passed, false, "1 of 5 is below the pass threshold");
  assert.equal(done.body.view.nodes[1].state, "locked", "failing does not unlock the next lesson");
});

test("passing a lesson unlocks the next one and grants a crown", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const lesson = ctx.course.units[0].lessons[0];
  const start = await ctx.call("POST", "/api/sessions", { courseId: ctx.course.id, lessonId: lesson.id });
  const session = start.body.session;

  // Answer everything correctly, reading the key from the store-side course.
  for (const playable of session.exercises) {
    const source = lesson.exercises.find((e) => e.id === playable.id);
    const answer = correctAnswerFor(source);
    const res = await ctx.call("POST", `/api/sessions/${session.id}/answer`, { exerciseId: playable.id, answer });
    assert.equal(res.body.result.correct, true, `${source.type} should grade correct`);
  }

  const done = await ctx.call("POST", `/api/sessions/${session.id}/complete`, {});
  assert.equal(done.body.passed, true);
  assert.equal(done.body.perfect, true);
  assert.equal(done.body.crownEarned, true);
  assert.ok(done.body.xpAwarded > 0);
  assert.equal(done.body.progress.hearts, 5, "a flawless run costs no hearts");
  assert.equal(done.body.view.nodes[1].state, "available", "the next lesson unlocks");
  assert.equal(done.body.progress.streak.current, 1);
});

test("a session cannot be completed twice", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const lessonId = ctx.course.units[0].lessons[0].id;
  const { body } = await ctx.call("POST", "/api/sessions", { courseId: ctx.course.id, lessonId });
  await ctx.call("POST", `/api/sessions/${body.session.id}/complete`, {});
  const second = await ctx.call("POST", `/api/sessions/${body.session.id}/complete`, {});
  assert.equal(second.status, 409, "double-completing would double-award XP");
});

test("answers are rejected for exercises outside the session", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const first = ctx.course.units[0].lessons[0];
  const other = ctx.course.units[0].lessons[1].exercises[0];
  const { body } = await ctx.call("POST", "/api/sessions", { courseId: ctx.course.id, lessonId: first.id });
  const res = await ctx.call("POST", `/api/sessions/${body.session.id}/answer`, {
    exerciseId: other.id,
    answer: { kind: "choice", value: "anything" },
  });
  assert.equal(res.status, 400);
});

test("an unwritten lesson cannot be started", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  await ctx.store.updateCourse(ctx.course.id, (c) => ({
    ...c,
    units: c.units.map((u, i) =>
      i === 0 ? { ...u, lessons: u.lessons.map((l, j) => (j === 0 ? { ...l, authored: false } : l)) } : u,
    ),
  }));
  const res = await ctx.call("POST", "/api/sessions", {
    courseId: ctx.course.id,
    lessonId: ctx.course.units[0].lessons[0].id,
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not been written/);
});

test("practice assembles a session even before anything is due", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const res = await ctx.call("POST", "/api/sessions", { courseId: ctx.course.id, kind: "practice" });
  assert.equal(res.status, 200);
  assert.equal(res.body.session.kind, "practice");
  assert.ok(res.body.session.exercises.length > 0, "practice must never open empty");
});

test("the MCP authoring path plans a course and writes a lesson", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const created = await ctx.store.saveCourse({
    ...ferrofluidCourse(),
    id: "crs_agenttest",
    slug: "agent-test",
    title: "Agent Test",
    units: [],
    status: "planning",
  });

  const plan = await ctx.call("POST", `/api/courses/${created.id}/plan`, {
    title: "Tides",
    description: "How tides work.",
    level: "beginner",
    color: "#3b82f6",
    units: [{ title: "Basics", description: "", lessons: [{ title: "The Moon's pull", objective: "Explain tides." }] }],
  });
  assert.equal(plan.status, 200);
  const lessonId = plan.body.lessons[0].id;
  assert.ok(lessonId, "the agent is handed a generated lesson id");

  const write = await ctx.call("POST", `/api/courses/${created.id}/lessons/${lessonId}`, {
    notes: "Tides are caused by the Moon's gravitational gradient across the Earth.",
    exercises: [
      {
        type: "multiple_choice",
        prompt: "What causes tides?",
        choices: ["The Moon's gravity", "Wind", "Earth's rotation alone"],
        answer: "The Moon's gravity",
        explanation: "It is the gradient of the Moon's gravity across the Earth.",
      },
      { type: "true_false", prompt: "There are two high tides a day.", answer: true },
      {
        type: "fill_blank",
        prompt: "Tides are caused by the Moon's gravitational ___.",
        blanks: [{ accepted: ["gradient", "pull"] }],
      },
    ],
  });
  assert.equal(write.status, 200);
  assert.equal(write.body.exerciseCount, 3);
  assert.equal(write.body.remaining, 0);

  const status = await ctx.call("POST", `/api/courses/${created.id}/status`, { status: "ready" });
  assert.equal(status.body.status, "ready");
  assert.equal(status.body.authored, 1);
});

test("invalid agent-authored content is rejected with a fixable message", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const lessonId = ctx.course.units[0].lessons[0].id;
  const res = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${lessonId}`, {
    notes: "notes",
    exercises: [
      {
        type: "multiple_choice",
        prompt: "Pick one.",
        choices: ["A", "B"],
        answer: "C", // not among the choices
      },
      { type: "true_false", prompt: "True?", answer: true },
      { type: "true_false", prompt: "Also true?", answer: false },
    ],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.detail, /is not one of choices/, "the agent is told exactly what to fix");
});

test("writing to an unknown lesson id points the agent at course_get", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const res = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/lsn_nope`, {
    notes: "x",
    exercises: [
      { type: "true_false", prompt: "a", answer: true },
      { type: "true_false", prompt: "b", answer: true },
      { type: "true_false", prompt: "c", answer: true },
    ],
  });
  assert.equal(res.status, 404);
  assert.match(res.body.error, /course_get/);
});

test("cross-origin requests without the token are refused", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const res = await fetch(`${ctx.base}/api/state`, { headers: { origin: "http://evil.example" } });
  assert.equal(res.status, 403, "a web page must not be able to read local courses");

  const withToken = await fetch(`${ctx.base}/api/state`, {
    headers: { origin: "http://evil.example", "x-metaharness-token": ctx.app.token },
  });
  assert.equal(withToken.status, 200, "the MCP server's token still works");
});

test("SSE broadcasts course updates to a connected client", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const controller = new AbortController();
  t.after(() => controller.abort());
  const res = await fetch(`${ctx.base}/api/events`, {
    headers: { origin: ctx.base },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  await reader.read(); // the initial retry directive

  const received = (async () => {
    const deadline = Date.now() + 5000;
    let buffer = "";
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const line = buffer.split("\n").find((l) => l.startsWith("data: "));
      if (line) return JSON.parse(line.slice(6));
    }
    return undefined;
  })();

  await ctx.call("POST", `/api/courses/${ctx.course.id}/research`, { notes: "hello", sources: [] });
  const event = await received;
  assert.equal(event?.type, "course.updated");
  assert.equal(event.course.id, ctx.course.id);
});

test("grade parsing survives the ways models wrap JSON", () => {
  const fenced = parseGrade('Sure!\n```json\n{"correct": true, "score": 0.9, "feedback": "Good."}\n```\nHope that helps.');
  assert.equal(fenced?.correct, true);
  assert.equal(fenced?.score, 0.9);
  assert.equal(fenced?.provisional, false);

  const bare = parseGrade('{"correct": false, "score": 0.2, "feedback": "Missing the key idea.", "missed": ["x"]}');
  assert.equal(bare?.correct, false);
  assert.equal(bare?.detail?.length, 1);

  assert.equal(parseGrade("I think that is right."), undefined, "prose with no JSON yields no verdict");
  assert.equal(parseGrade('{"score": 0.5}'), undefined, "a verdict without `correct` is unusable");

  const clamped = parseGrade('{"correct": true, "score": 5}');
  assert.equal(clamped?.score, 1, "out-of-range scores are clamped");
});

function correctAnswerFor(exercise) {
  switch (exercise.type) {
    case "multiple_choice":
      return { kind: "choice", value: exercise.answer };
    case "multi_select":
      return { kind: "choices", values: exercise.answers };
    case "true_false":
      return { kind: "boolean", value: exercise.answer };
    case "fill_blank":
      return { kind: "blanks", values: exercise.blanks.map((b) => b.accepted[0]) };
    case "match_pairs":
      return { kind: "pairs", values: exercise.pairs.map((p) => ({ left: p.left, right: p.right })) };
    case "order_sequence":
      return { kind: "order", values: exercise.items };
    case "categorize":
      return { kind: "categorize", values: exercise.items.map((i) => ({ text: i.text, category: i.category })) };
    case "short_answer":
      return { kind: "text", value: exercise.exemplar };
    case "flashcard":
      return { kind: "selfRated", value: "good" };
    default:
      throw new Error(`unhandled ${exercise.type}`);
  }
}
