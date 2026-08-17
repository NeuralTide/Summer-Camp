import test from "node:test";
import assert from "node:assert/strict";
import { parseControlBlock } from "../dist/index.js";

/**
 * The setup interview's one fragile seam.
 *
 * The control block is the agent's side of a contract it was told about in
 * prose, so it arrives as free-form JSON from a model that has been asked
 * nicely. Everything here is a shape a real reply can plausibly take, and the
 * rule throughout is that a malformed block degrades — the learner loses their
 * tappable replies for one turn — rather than throwing and killing the
 * conversation.
 */

const READY = JSON.stringify({
  topic: "Chess openings",
  title: "Chess openings",
  level: "intermediate",
  focus: "ideas over memorised lines",
  curation: "auto",
  buildConfig: { maxUnits: 4, maxLessonsPerUnit: 5, maxExercisesPerLesson: 8, maxSources: 8, skipResearch: false },
});

test("suggested replies are lifted out and the block never reaches the learner", () => {
  const { text, suggest, ready } = parseControlBlock(
    'Have you played much before?\n\n```metaharness\n{"suggest": ["Never", "A bit", "I play regularly"]}\n```',
  );

  assert.equal(text, "Have you played much before?");
  assert.deepEqual(suggest, ["Never", "A bit", "I play regularly"]);
  assert.equal(ready, undefined);
});

test("a finished setup is returned as a build request", () => {
  const { text, ready } = parseControlBlock(`I'll build you an intermediate course on chess openings.\n\n\`\`\`metaharness\n{"ready": ${READY}}\n\`\`\``);

  assert.equal(text, "I'll build you an intermediate course on chess openings.");
  assert.equal(ready?.topic, "Chess openings");
  assert.equal(ready?.level, "intermediate");
  assert.equal(ready?.buildConfig.maxUnits, 4);
  assert.equal(ready?.curation, "auto");
});

test("a reply with no block at all still shows its prose", () => {
  const { text, suggest, ready } = parseControlBlock("What would you like to learn?");
  assert.equal(text, "What would you like to learn?");
  assert.deepEqual(suggest, []);
  assert.equal(ready, undefined);
});

test("a mistagged or malformed block costs the replies, not the turn", () => {
  const mistagged = parseControlBlock('Pick one.\n\n```json\n{"suggest": ["Yes", "No"]}\n```');
  assert.equal(mistagged.text, "Pick one.", "the block is stripped whichever tag it carries");
  assert.deepEqual(mistagged.suggest, ["Yes", "No"]);

  const broken = parseControlBlock('Pick one.\n\n```metaharness\n{"suggest": ["Yes",\n```');
  assert.match(broken.text, /Pick one/, "unparseable JSON must not throw");
  assert.deepEqual(broken.suggest, []);
});

test("an example block followed by the real one keeps the real one", () => {
  const { ready } = parseControlBlock(
    `Here's the shape:\n\n\`\`\`metaharness\n{"suggest": ["ignore me"]}\n\`\`\`\n\nRight, building it.\n\n\`\`\`metaharness\n{"ready": ${READY}}\n\`\`\``,
  );
  assert.equal(ready?.topic, "Chess openings", "the block it finished on wins");
});

test("limits outside the enforced range are rejected rather than clamped", () => {
  // 40 units would be accepted here and then bounced by enforceBuildConfig
  // mid-build, after the learner had already pressed the button.
  const { ready, text } = parseControlBlock(
    'Building it.\n\n```metaharness\n{"ready": {"topic": "Chess", "level": "beginner", "buildConfig": {"maxUnits": 40}}}\n```',
  );
  assert.equal(ready, undefined, "an out-of-range plan must not reach the build endpoint");
  assert.equal(text, "Building it.");
});

test("a ready block missing its topic is not a build request", () => {
  const { ready } = parseControlBlock('Done.\n\n```metaharness\n{"ready": {"level": "beginner"}}\n```');
  assert.equal(ready, undefined);
});

test("title falls back to the topic, and defaults fill the rest", () => {
  const { ready } = parseControlBlock('Building.\n\n```metaharness\n{"ready": {"topic": "Ferrofluids"}}\n```');
  assert.equal(ready?.title, "Ferrofluids");
  assert.equal(ready?.level, "beginner");
  assert.equal(ready?.curation, "auto");
  assert.equal(ready?.buildConfig.maxUnits, 6, "BuildConfigSchema's own defaults apply");
});

test("suggestions are capped and blanks dropped", () => {
  const { suggest } = parseControlBlock(
    'Pick.\n\n```metaharness\n{"suggest": ["a", "", "b", "c", "d", "e", 7]}\n```',
  );
  assert.deepEqual(suggest, ["a", "b", "c", "d"], "at most four, strings only");
});
