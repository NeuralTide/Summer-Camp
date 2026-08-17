import test from "node:test";
import assert from "node:assert/strict";
import {
  ExerciseSchema,
  gradeExercise,
  isTypoMatch,
  newCard,
  reviewCard,
  isDue,
  emptyProgress,
  settleHearts,
  loseHeart,
  touchStreak,
  completeLesson,
  courseProgress,
  RULES,
  CourseSchema,
  formatZodError,
  toPlayable,
  seededRandom,
  dayKey,
} from "../dist/index.js";

const base = { id: "e1", difficulty: 2, tags: [] };

test("multiple_choice rejects an answer that is not among the choices", () => {
  const bad = ExerciseSchema.safeParse({
    ...base,
    type: "multiple_choice",
    prompt: "Which is a ferrofluid property?",
    choices: ["Superparamagnetism", "Ferroelectricity"],
    answer: "Superparamagnetic", // subtly different from the choice
  });
  assert.equal(bad.success, false);
  assert.match(formatZodError(bad.error), /is not one of choices/);
});

test("fill_blank enforces marker count and word bank contents", () => {
  const mismatched = ExerciseSchema.safeParse({
    ...base,
    type: "fill_blank",
    prompt: "Spikes appear when ___ exceeds ___.",
    blanks: [{ accepted: ["magnetic pressure"] }],
  });
  assert.equal(mismatched.success, false);
  assert.match(formatZodError(mismatched.error), /2 "___" marker\(s\) but 1 blank/);

  const missingWord = ExerciseSchema.safeParse({
    ...base,
    type: "fill_blank",
    prompt: "Spikes appear when ___ exceeds surface tension.",
    blanks: [{ accepted: ["magnetic pressure"] }],
    wordBank: ["viscosity", "density"],
  });
  assert.equal(missingWord.success, false);
  assert.match(formatZodError(missingWord.error), /missing the canonical answer/);
});

test("categorize rejects an item pointing at an undeclared category", () => {
  const bad = ExerciseSchema.safeParse({
    ...base,
    type: "categorize",
    prompt: "Sort these.",
    categories: ["Ferro", "Para"],
    items: [
      { text: "Iron", category: "Ferro" },
      { text: "Aluminium", category: "Paramagnetic" },
      { text: "Cobalt", category: "Ferro" },
      { text: "Oxygen", category: "Para" },
    ],
  });
  assert.equal(bad.success, false);
  assert.match(formatZodError(bad.error), /is not in/);
});

test("multi_select awards partial credit and penalises false positives", () => {
  const ex = ExerciseSchema.parse({
    ...base,
    type: "multi_select",
    prompt: "Select the magnetic materials.",
    choices: ["Iron", "Nickel", "Copper", "Wood"],
    answers: ["Iron", "Nickel"],
  });

  const perfect = gradeExercise(ex, { kind: "choices", values: ["Iron", "Nickel"] });
  assert.equal(perfect.correct, true);
  assert.equal(perfect.score, 1);

  const partial = gradeExercise(ex, { kind: "choices", values: ["Iron"] });
  assert.equal(partial.correct, false);
  assert.equal(partial.score, 0.5);

  const overshoot = gradeExercise(ex, { kind: "choices", values: ["Iron", "Nickel", "Copper"] });
  assert.equal(overshoot.correct, false);
  assert.equal(overshoot.score, 0.5, "one false positive cancels one hit");
});

test("typed answers tolerate typos in long words but not short ones", () => {
  assert.equal(isTypoMatch("magnetisation", "magnetization"), true);
  assert.equal(isTypoMatch("Surfactant", "surfactant"), true, "case-insensitive");
  assert.equal(isTypoMatch("cap", "cat"), false, "short words must be exact");
});

test("fill_blank grades per blank with partial credit", () => {
  const ex = ExerciseSchema.parse({
    ...base,
    type: "fill_blank",
    prompt: "A ferrofluid is a ___ of ___ nanoparticles.",
    blanks: [{ accepted: ["colloid", "colloidal suspension"] }, { accepted: ["magnetic", "ferromagnetic"] }],
  });
  const half = gradeExercise(ex, { kind: "blanks", values: ["colloid", "electric"] });
  assert.equal(half.correct, false);
  assert.equal(half.score, 0.5);
  assert.deepEqual(
    half.detail.map((d) => d.correct),
    [true, false],
  );

  const synonym = gradeExercise(ex, { kind: "blanks", values: ["colloidal suspension", "ferromagnetic"] });
  assert.equal(synonym.correct, true);
});

test("order_sequence scores by items in the right position", () => {
  const ex = ExerciseSchema.parse({
    ...base,
    type: "order_sequence",
    prompt: "Order the steps.",
    items: ["Synthesise magnetite", "Add surfactant", "Disperse in carrier", "Apply field"],
  });
  const reversedMiddle = gradeExercise(ex, {
    kind: "order",
    values: ["Synthesise magnetite", "Disperse in carrier", "Add surfactant", "Apply field"],
  });
  assert.equal(reversedMiddle.correct, false);
  assert.equal(reversedMiddle.score, 0.5);
});

test("short_answer is provisional and enforces a minimum length", () => {
  const ex = ExerciseSchema.parse({
    ...base,
    type: "short_answer",
    prompt: "Why do spikes form?",
    keyPoints: ["magnetic pressure overcomes surface tension and gravity"],
    exemplar: "Because magnetic pressure exceeds the restoring forces of surface tension and gravity.",
    minWords: 5,
  });

  const tooShort = gradeExercise(ex, { kind: "text", value: "magnetism" });
  assert.equal(tooShort.correct, false);
  assert.match(tooShort.feedback, /at least 5 words/);

  const good = gradeExercise(ex, {
    kind: "text",
    value: "The magnetic pressure overcomes the surface tension and gravity holding the fluid flat.",
  });
  assert.equal(good.correct, true);
  assert.equal(good.provisional, true, "an LLM pass may still revise this");
});

test("playable exercises never leak the answer key", () => {
  const ex = ExerciseSchema.parse({
    ...base,
    type: "multiple_choice",
    prompt: "Pick one.",
    choices: ["A", "B", "C"],
    answer: "A",
  });
  const playable = toPlayable(ex, seededRandom("seed-1"));
  assert.equal("answer" in playable, false);
  assert.deepEqual([...playable.choices].sort(), ["A", "B", "C"]);
});

test("option shuffling is deterministic per session id but varies across sessions", () => {
  const ex = ExerciseSchema.parse({
    ...base,
    type: "multiple_choice",
    prompt: "Pick one.",
    choices: ["A", "B", "C", "D", "E", "F"],
    answer: "A",
  });
  const a = toPlayable(ex, seededRandom("session-a")).choices;
  const again = toPlayable(ex, seededRandom("session-a")).choices;
  assert.deepEqual(a, again, "same session id reproduces the same order");

  const orders = new Set();
  for (let i = 0; i < 25; i++) orders.add(toPlayable(ex, seededRandom(`s${i}`)).choices.join(","));
  assert.ok(orders.size > 5, `expected varied orders across sessions, got ${orders.size}`);
});

test("SM-2 lapses reset the interval and passes grow it", () => {
  let card = newCard("e1", "c1", "l1");
  card = reviewCard(card, 1);
  assert.equal(card.intervalDays, 1);
  card = reviewCard(card, 1);
  assert.equal(card.intervalDays, 3);
  card = reviewCard(card, 1);
  assert.ok(card.intervalDays > 3, "third pass extends beyond three days");
  const grown = card.intervalDays;

  card = reviewCard(card, 0);
  assert.equal(card.streak, 0);
  assert.equal(card.lapses, 1);
  assert.ok(card.intervalDays < grown, "a lapse shortens the interval");
  assert.ok(card.ease < 2.5, "a lapse lowers ease");
});

test("a lapsed card is due again immediately", () => {
  let card = newCard("e1", "c1", "l1");
  card = reviewCard(card, 1);
  assert.equal(isDue(card), false, "a passed card is not due right away");
  card = reviewCard(card, 0);
  assert.equal(isDue(card, new Date(Date.now() + 1000)), true);
});

test("hearts regenerate on wall-clock time and keep partial progress", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  let p = emptyProgress(now);
  p = loseHeart(p, now);
  p = loseHeart(p, now);
  assert.equal(p.hearts, RULES.maxHearts - 2);

  const later = new Date(now.getTime() + RULES.heartRegenMs * 1.5);
  const settled = settleHearts(p, later);
  assert.equal(settled.hearts, RULES.maxHearts - 1, "one heart back, not two");

  const muchLater = new Date(now.getTime() + RULES.heartRegenMs * 99);
  assert.equal(settleHearts(p, muchLater).hearts, RULES.maxHearts, "caps at max");
});

test("streaks increment once per day, survive a one-day gap, and reset after two", () => {
  const day1 = new Date("2026-08-11T20:00:00");
  let p = touchStreak(emptyProgress(day1), day1);
  assert.equal(p.streak.current, 1);

  p = touchStreak(p, new Date("2026-08-11T22:00:00"));
  assert.equal(p.streak.current, 1, "studying twice in a day does not double-count");

  p = touchStreak(p, new Date("2026-08-12T09:00:00"));
  assert.equal(p.streak.current, 2);

  p = touchStreak(p, new Date("2026-08-15T09:00:00"));
  assert.equal(p.streak.current, 1, "a three-day gap restarts at today");
  assert.equal(p.streak.longest, 2, "the record is kept");
});

test("completing a lesson awards XP, a crown, and caps crowns at the maximum", () => {
  const now = new Date("2026-08-11T12:00:00");
  let p = emptyProgress(now);
  const opts = { score: 1, correctCount: 5, perfect: true };

  const first = completeLesson(p, "c1", "l1", opts, now);
  assert.equal(first.crownEarned, true);
  assert.equal(
    first.xpAwarded,
    5 * RULES.xpPerCorrect + RULES.xpLessonComplete + RULES.xpPerfectBonus,
  );
  assert.equal(first.progress.dailyXp[dayKey(now)], first.xpAwarded);

  p = first.progress;
  for (let i = 1; i < RULES.maxCrowns; i++) p = completeLesson(p, "c1", "l1", opts, now).progress;
  assert.equal(p.lessons.l1.crowns, RULES.maxCrowns);

  const beyond = completeLesson(p, "c1", "l1", opts, now);
  assert.equal(beyond.crownEarned, false, "crowns cap");
  assert.ok(beyond.xpAwarded > 0, "but repeating still pays XP");
});

test("a failed lesson records the score without granting a crown or unlocking the next", () => {
  const now = new Date("2026-08-11T12:00:00");
  const failed = completeLesson(emptyProgress(now), "c1", "l1", { score: 0.4, correctCount: 2, perfect: false }, now);
  assert.equal(failed.crownEarned, false);
  assert.equal(failed.progress.lessons.l1.completions, 0);
  assert.equal(failed.progress.lessons.l1.lastScore, 0.4);
});

function courseFixture() {
  const mkExercise = (id) => ({
    id,
    type: "multiple_choice",
    prompt: `Question ${id}`,
    choices: ["A", "B"],
    answer: "A",
    difficulty: 2,
    tags: [],
  });
  return CourseSchema.parse({
    id: "c1",
    slug: "ferro",
    title: "Ferrofluids",
    topic: "ferrofluids",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    units: [
      {
        id: "u1",
        title: "Unit 1",
        lessons: [
          { id: "l1", title: "L1", objective: "o", authored: true, exercises: [mkExercise("x1")] },
          { id: "l2", title: "L2", objective: "o", authored: true, exercises: [mkExercise("x2")] },
          { id: "l3", title: "L3", objective: "o", authored: false, exercises: [] },
        ],
      },
    ],
  });
}

test("lessons unlock strictly in order and unauthored stubs stay locked", () => {
  const course = courseFixture();
  const now = new Date();
  let p = emptyProgress(now);

  let view = courseProgress(course, p, now);
  assert.deepEqual(view.nodes.map((n) => n.state), ["available", "locked", "locked"]);
  assert.equal(view.nextLessonId, "l1");

  p = completeLesson(p, "c1", "l1", { score: 1, correctCount: 1, perfect: true }, now).progress;
  view = courseProgress(course, p, now);
  assert.deepEqual(view.nodes.map((n) => n.state), ["complete", "available", "locked"]);
  assert.equal(view.nextLessonId, "l2", "continue points at the next unplayed lesson");

  p = completeLesson(p, "c1", "l2", { score: 1, correctCount: 1, perfect: true }, now).progress;
  view = courseProgress(course, p, now);
  assert.equal(view.nodes[2].state, "locked", "the unauthored stub is still not playable");
  assert.equal(view.lessonsComplete, 2);
});

test("a failed attempt does not unlock the following lesson", () => {
  const course = courseFixture();
  const now = new Date();
  const p = completeLesson(emptyProgress(now), "c1", "l1", { score: 0.3, correctCount: 0, perfect: false }, now).progress;
  const view = courseProgress(course, p, now);
  assert.equal(view.nodes[1].state, "locked");
});
