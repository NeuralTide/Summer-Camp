import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@metaharness/core";
import { createApp } from "../dist/index.js";
import { provenanceFixture } from "../dist/fixture.js";
import { TUTOR_SYSTEM_PROMPT, tutorReplyPrompt } from "../dist/prompts.js";

/**
 * The tutor runs a real agent turn, so nothing here may reach one — a test that
 * spawned a session would spend the learner's usage to assert something. What is
 * reachable is the prompt it would be given, and every guard that stands in
 * front of the spawn.
 */
async function bootApp() {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-tutor-"));
  const store = new Store(dir);
  await store.init();
  const { course, archive } = provenanceFixture();
  const saved = await store.saveCourse(course);
  await store.saveArchives(saved.id, [archive]);

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
    store,
    course: saved,
    lessonId: saved.units[0].lessons[0].id,
    call,
    async cleanup() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("the tutor is given the lesson the learner is actually reading", () => {
  const { course } = provenanceFixture();
  const lesson = course.units[0].lessons[0];
  const claimIds = new Set(lesson.citations.map((c) => c.claimId));

  const prompt = tutorReplyPrompt({
    courseTitle: course.title,
    lessonTitle: lesson.title,
    objective: lesson.objective,
    notes: lesson.notes,
    claims: course.claims.filter((c) => claimIds.has(c.id)),
    turns: [{ role: "user", text: "Why do the ions move at all?" }],
  });

  assert.ok(prompt.includes(lesson.title));
  assert.ok(prompt.includes("During discharge, lithium ions travel"), "the lesson text goes with the question");
  assert.ok(prompt.includes("Why do the ions move at all?"));
  // The verified quotes travel too — they are the part of the tutor's picture
  // that was actually checked against a document.
  assert.ok(prompt.includes("checked word for word"));
  assert.ok(prompt.includes(course.claims[0].quote.slice(0, 40)));
});

/**
 * A tutor that hands over exercise answers converts a lesson into a form to
 * fill in. The instruction is load-bearing enough to pin.
 */
test("the tutor is told not to answer exercises or invent facts", () => {
  assert.match(TUTOR_SYSTEM_PROMPT, /Never answer an exercise for them outright/);
  assert.match(TUTOR_SYSTEM_PROMPT, /Do not invent facts/);
  // And that changing the lesson is somebody else's job, with a route to it.
  assert.match(TUTOR_SYSTEM_PROMPT, /report/i);
});

test("only the claims this lesson rests on are sent, not the whole research pile", () => {
  const { course } = provenanceFixture();
  const lesson = course.units[0].lessons[0];
  const cited = new Set(lesson.citations.map((c) => c.claimId));

  // The fixture cites everything it holds, so an uncited claim has to be added
  // for this to test anything. A real course carries plenty: research gathers
  // for the whole course, and each lesson uses a slice of it.
  course.claims.push({
    id: "clm_elsewhere",
    text: "Thermal runaway is a self-sustaining reaction.",
    sourceUrl: course.sources[0].url,
    quote: "Overheating a cell can trigger thermal runaway",
  });
  assert.ok(!cited.has("clm_elsewhere"));

  const prompt = tutorReplyPrompt({
    courseTitle: course.title,
    lessonTitle: lesson.title,
    objective: lesson.objective,
    notes: lesson.notes,
    claims: course.claims.filter((c) => cited.has(c.id)),
    turns: [{ role: "user", text: "hi" }],
  });
  const excluded = course.claims.filter((c) => !cited.has(c.id));
  assert.equal(excluded.length, 1, "this test is worthless if nothing is excluded");
  for (const claim of excluded) {
    assert.ok(!prompt.includes(claim.quote), "a claim this lesson does not rest on must not be sent");
  }
  // …while the ones it does rest on are all there.
  for (const claim of course.claims.filter((c) => cited.has(c.id))) {
    assert.ok(prompt.includes(claim.quote));
  }
});

test("a lesson nobody has written yet cannot be asked about", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  await ctx.store.updateCourse(ctx.course.id, (c) => ({
    ...c,
    units: c.units.map((u) => ({ ...u, lessons: u.lessons.map((l) => ({ ...l, authored: false })) })),
  }));

  // Refused before any driver is resolved, so an unwritten lesson costs nothing.
  const { status, body } = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}/chat`, {
    turns: [{ role: "user", text: "What is this about?" }],
  });
  assert.equal(status, 400);
  assert.match(body.error ?? "", /not been written/i);
});

test("an unknown lesson is refused rather than answered about nothing", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const { status, body } = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/lsn_nope/chat`, {
    turns: [{ role: "user", text: "hello" }],
  });
  assert.equal(status, 400);
  assert.match(body.error ?? "", /unknown lesson/i);
});

test("an empty or malformed transcript never reaches a driver", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());
  const path = `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}/chat`;

  for (const turns of [[], [{ role: "user", text: "   " }], [{ role: "tutor", text: "hi" }], [{ text: "hi" }]]) {
    const { status } = await ctx.call("POST", path, { turns });
    assert.equal(status, 400, `${JSON.stringify(turns)} should be refused`);
  }
});
