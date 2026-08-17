import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CourseSchema, Store } from "@metaharness/core";
import { createApp } from "../dist/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MCP_ENTRY = fileURLToPath(new URL("../../mcp/dist/index.js", import.meta.url));

/**
 * Exercises the real seam an authoring agent uses: a genuine MCP client speaking
 * stdio to the metaharness MCP server, which proxies to a live daemon.
 */
async function connect() {
  const dir = await mkdtemp(join(tmpdir(), "mh-mcp-"));
  const store = new Store(dir);
  await store.init();

  const now = new Date().toISOString();
  // Parsed rather than hand-built: saveCourse takes the document as given, so a
  // literal here would be missing every defaulted field (buildConfig above all,
  // which the write endpoints dereference to enforce their limits).
  await store.saveCourse(
    CourseSchema.parse({
      id: "crs_mcp",
      slug: "mcp-demo",
      title: "Placeholder",
      topic: "photosynthesis",
      createdAt: now,
      updatedAt: now,
    }),
  );

  const app = createApp({ store, port: 0, host: "127.0.0.1" });
  const { port } = await app.listen();

  const client = new Client({ name: "metaharness-test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [MCP_ENTRY],
      env: {
        ...process.env,
        METAHARNESS_API: `http://127.0.0.1:${port}`,
        METAHARNESS_TOKEN: app.token,
        METAHARNESS_COURSE_ID: "crs_mcp",
      },
    }),
  );

  return {
    client,
    store,
    async cleanup() {
      await client.close();
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const textOf = (result) => result.content.map((c) => c.text).join("\n");

test("the MCP server exposes the authoring toolset", async (t) => {
  const ctx = await connect();
  t.after(() => ctx.cleanup());

  const { tools } = await ctx.client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    "course_get",
    "course_plan",
    "course_status",
    "lesson_write",
    "progress_get",
    "research_note",
  ]);

  const write = tools.find((tool) => tool.name === "lesson_write");
  assert.ok(write.inputSchema.properties.exercises, "lesson_write advertises its exercise schema");
  assert.ok(/4-8/.test(write.description), "the description carries the authoring brief");
});

test("an agent can plan, recover from a bad write, and publish", async (t) => {
  const ctx = await connect();
  t.after(() => ctx.cleanup());

  // The course id comes from the environment, so no tool call needs to pass it.
  const plan = await ctx.client.callTool({
    name: "course_plan",
    arguments: {
      title: "Photosynthesis",
      description: "How plants turn light into sugar.",
      level: "beginner",
      color: "#22c55e",
      units: [
        {
          title: "Light reactions",
          description: "",
          lessons: [{ title: "Catching photons", objective: "Describe how chlorophyll absorbs light.", kind: "concept" }],
        },
      ],
      sources: [],
    },
  });
  assert.ok(!plan.isError, textOf(plan));
  const lessonId = textOf(plan).match(/(lsn_[a-z0-9]+)/)?.[1];
  assert.ok(lessonId, "the agent is handed a lesson id to write against");

  // A realistic model mistake: the answer is not character-identical to a choice.
  const bad = await ctx.client.callTool({
    name: "lesson_write",
    arguments: {
      lessonId,
      notes: "Chlorophyll absorbs red and blue light.",
      exercises: [
        { type: "multiple_choice", prompt: "Which colour is reflected?", choices: ["Green", "Red"], answer: "Greenish" },
        { type: "true_false", prompt: "Chlorophyll absorbs blue light.", answer: true },
        { type: "true_false", prompt: "Plants eat soil.", answer: false },
      ],
    },
  });
  assert.equal(bad.isError, true, "a broken exercise must not be silently accepted");
  assert.match(textOf(bad), /is not one of choices/, "and the agent is told precisely what to fix");

  const good = await ctx.client.callTool({
    name: "lesson_write",
    arguments: {
      lessonId,
      notes: "Chlorophyll absorbs red and blue light, reflecting green.",
      exercises: [
        {
          type: "multiple_choice",
          prompt: "Which colour is reflected?",
          choices: ["Green", "Red"],
          answer: "Green",
          explanation: "Green is reflected, which is why leaves look green.",
        },
        { type: "true_false", prompt: "Chlorophyll absorbs blue light.", answer: true },
        { type: "fill_blank", prompt: "Leaves look green because green light is ___.", blanks: [{ accepted: ["reflected"] }] },
      ],
    },
  });
  assert.ok(!good.isError, textOf(good));
  assert.match(textOf(good), /All lessons are now written/);

  const status = await ctx.client.callTool({ name: "course_status", arguments: { status: "ready" } });
  assert.match(textOf(status), /"ready" \(1\/1 lessons written\)/);

  const course = JSON.parse(textOf(await ctx.client.callTool({ name: "course_get", arguments: {} })));
  assert.equal(course.title, "Photosynthesis");
  assert.equal(course.units[0].lessons[0].authored, true);
  assert.equal(course.units[0].lessons[0].exerciseCount, 3);
  assert.equal(
    "exercises" in course.units[0].lessons[0],
    false,
    "course_get without content must not echo back whole exercises",
  );
});

test("research notes reach the course and survive to the authoring pass", async (t) => {
  const ctx = await connect();
  t.after(() => ctx.cleanup());

  await ctx.client.callTool({
    name: "research_note",
    arguments: {
      notes: "Chlorophyll a peaks at 430 nm and 662 nm.",
      sources: [{ title: "Plant Physiology", url: "https://example.org/chlorophyll" }],
      append: true,
    },
  });
  await ctx.client.callTool({
    name: "research_note",
    arguments: { notes: "The Calvin cycle fixes CO2 using ATP and NADPH.", sources: [], append: true },
  });

  const course = ctx.store.getCourse("crs_mcp");
  assert.match(course.researchNotes, /430 nm/);
  assert.match(course.researchNotes, /Calvin cycle/, "append must not overwrite earlier notes");
  assert.equal(course.sources.length, 1);
});
