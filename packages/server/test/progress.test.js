import test from "node:test";
import assert from "node:assert/strict";
import { courseProgress, emptyProgress } from "@metaharness/core";

/**
 * A course whose written lessons are scattered rather than contiguous — the
 * shape authorPass produces when one of its round-robin workers fails.
 *
 * Lessons 0, 2 and 4 are written; 1 and 3 are not.
 */
function gappyCourse() {
  const lesson = (n, authored) => ({
    id: `l${n}`,
    title: `Lesson ${n}`,
    objective: "",
    kind: "concept",
    authored,
    notes: "",
    exercises: authored
      ? [{ id: `e${n}`, type: "true_false", prompt: "p", answer: true, explanation: "", difficulty: 1, tags: [] }]
      : [],
  });
  return {
    id: "c1",
    slug: "c1",
    title: "Gappy",
    topic: "t",
    description: "",
    level: "beginner",
    status: "ready",
    color: "#769826",
    units: [
      { id: "u1", title: "Unit 1", description: "", lessons: [lesson(0, true), lesson(1, false), lesson(2, true)] },
      { id: "u2", title: "Unit 2", description: "", lessons: [lesson(3, false), lesson(4, true)] },
    ],
    sources: [],
    researchNotes: "",
  };
}

/** Pass every lesson the learner can currently reach, to a fixpoint. */
function walkAsFarAsPossible(course) {
  let progress = emptyProgress();
  for (let i = 0; i < 20; i++) {
    const view = courseProgress(course, progress);
    const next = view.nodes.find((n) => n.state === "available");
    if (!next) break;
    progress = {
      ...progress,
      lessons: {
        ...progress.lessons,
        [next.lessonId]: {
          lessonId: next.lessonId,
          courseId: course.id,
          completions: 1,
          crowns: 1,
          bestScore: 1,
          lastScore: 1,
        },
      },
    };
  }
  return courseProgress(course, progress);
}

test("an unwritten lesson does not lock the written lessons after it", () => {
  const view = walkAsFarAsPossible(gappyCourse());
  const byId = Object.fromEntries(view.nodes.map((n) => [n.lessonId, n]));

  // The unwritten ones stay locked: there is nothing to play.
  assert.equal(byId.l1.state, "locked", "unwritten lesson should be locked");
  assert.equal(byId.l3.state, "locked", "unwritten lesson should be locked");

  // But every written lesson is reachable, including the ones behind a gap.
  // Before the fix these were locked forever and the course died at lesson 0.
  for (const id of ["l0", "l2", "l4"]) {
    assert.notEqual(byId[id].state, "locked", `${id} is written and must be reachable`);
  }
  assert.equal(view.lessonsComplete, 3, "all three written lessons should be completable");
});

test("sequential gating still holds between written lessons", () => {
  const course = gappyCourse();
  // A fresh learner can only see the first lesson; the rest wait their turn.
  const view = courseProgress(course, emptyProgress());
  const available = view.nodes.filter((n) => n.state === "available").map((n) => n.lessonId);
  assert.deepEqual(available, ["l0"], "only the first lesson should be open to a new learner");
});
