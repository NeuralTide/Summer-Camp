import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, locateProse, proseBlocks, provenanceKey } from "@metaharness/core";
import { createApp } from "../dist/index.js";
import { provenanceFixture } from "../dist/fixture.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function bootApp({ devMode = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-prov-"));
  const store = new Store(dir);
  await store.init();
  await store.updateConfig({ devMode });
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
  return { store, call, base, async cleanup() { await app.close(); await rm(dir, { recursive: true, force: true }); } };
}

/**
 * The fixture exists to make all three outcomes visible at once, so if it ever
 * stops producing all three it has quietly stopped being useful for the thing
 * it was built for — while still looking fine.
 */
test("the fixture shows a verbatim block, a reworded one, and one from nowhere", () => {
  const { course, archive } = provenanceFixture();
  const notes = course.units[0].lessons[0].notes;

  const blocks = proseBlocks(notes).filter((b) => b.length >= 40);
  const hits = locateProse(notes, [archive]);
  const kinds = hits.map((h) => h.kind);

  assert.ok(kinds.includes("verbatim"), "one paragraph should be found word for word");
  assert.ok(kinds.includes("paraphrase"), "one paragraph should be found as a rewording");
  assert.ok(hits.length < blocks.length, "and at least one should be found in no source at all");

  // The offsets have to land on real text, or the viewer highlights the wrong thing.
  for (const hit of hits) {
    const quoted = archive.text.slice(hit.start, hit.end);
    assert.ok(quoted.length > 20, `${hit.kind} highlight should not be empty`);
    assert.ok(archive.text.includes(quoted));
  }
});

test("a verbatim match is exact and a reworded one is not", () => {
  const { course, archive } = provenanceFixture();
  const hits = locateProse(course.units[0].lessons[0].notes, [archive]);

  const verbatim = hits.find((h) => h.kind === "verbatim");
  assert.equal(verbatim.score, 1);
  // The highlighted span is the sentence itself, not a window around it.
  assert.ok(archive.text.slice(verbatim.start, verbatim.end).startsWith("During discharge"));

  const paraphrase = hits.find((h) => h.kind === "paraphrase");
  assert.ok(paraphrase.score < 1 && paraphrase.score >= 0.6, `unexpected score ${paraphrase?.score}`);
});

test("nothing is claimed when there is no archive to check against", () => {
  const { course } = provenanceFixture();
  assert.deepEqual(locateProse(course.units[0].lessons[0].notes, []), []);
  // A source that failed to fetch must not be treated as evidence.
  const empty = { id: "src_x", url: "u", title: "t", fetchedAt: "", text: "", ok: false };
  assert.deepEqual(locateProse(course.units[0].lessons[0].notes, [empty]), []);
});

/**
 * The browser cannot import from core, so `provenanceKey` is duplicated in
 * SourcedNotes.tsx. The two sides use it to address the same blocks from
 * opposite ends — a drift between them does not throw, it just silently stops
 * marking paragraphs, which is indistinguishable from "this lesson has no
 * sources". Hence a test that reads both and compares them.
 */
test("the UI's copy of provenanceKey has not drifted from core's", async () => {
  const read = async (path) => await readFile(join(repoRoot, path), "utf8");
  const bodyOf = (src) => {
    const match = src.match(/function provenanceKey\(text: string\): string \{([\s\S]*?)\n\}/);
    assert.ok(match, "provenanceKey should be findable in both files");
    return match[1].replace(/\s+/g, " ").trim();
  };

  assert.equal(
    bodyOf(await read("packages/ui/src/components/SourcedNotes.tsx")),
    bodyOf(await read("packages/core/src/archive.ts")),
    "SourcedNotes.tsx and core/archive.ts must normalise block text identically",
  );
});

test("the key survives the trip through markdown rendering", () => {
  // What the server keys on is the markdown block; what the browser keys on is
  // the rendered element's textContent. Inline syntax is the difference.
  const markdown = "Charging **reverses** the process — an *external* voltage drives `lithium` ions back.";
  const rendered = "Charging reverses the process — an external voltage drives lithium ions back.";
  assert.equal(provenanceKey(proseBlocks(markdown)[0]), provenanceKey(rendered));
});

test("the fixture endpoint is only open in developer mode", async (t) => {
  const off = await bootApp({ devMode: false });
  t.after(() => off.cleanup());
  assert.equal((await off.call("POST", "/api/dev/fixture", {})).status, 403);

  const on = await bootApp({ devMode: true });
  t.after(() => on.cleanup());
  const made = await on.call("POST", "/api/dev/fixture", {});
  assert.equal(made.status, 200);
  assert.equal(made.body.course.lessonCount, 1);
});

test("the fixture's citations are verified, and point at a real document", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const made = await ctx.call("POST", "/api/dev/fixture", {});
  const courseId = made.body.course.id;
  const view = await ctx.call("GET", `/api/courses/${courseId}/view`);
  const lessonId = view.body.course.units[0].lessons[0].id;

  const prov = await ctx.call("GET", `/api/courses/${courseId}/lessons/${lessonId}/provenance`);
  assert.equal(prov.status, 200);
  assert.equal(prov.body.verified, true, "the fixture ships declared citations, not guesses");
  assert.equal(prov.body.blocks.length, 3);
  assert.ok(prov.body.proseCount > prov.body.blocks.length, "and one paragraph nobody vouched for");

  for (const hit of prov.body.blocks) {
    assert.equal(hit.verified, true);
    assert.ok(hit.claimId && hit.quote, "a verified block carries the claim and quote behind it");
    assert.equal(hit.hasDocument, true, "so the viewer can open the page itself");
  }

  /*
   * The distinction the reader is owed. Every one of these paragraphs cites a
   * quote that was verified against the page — but one repeats it, one restates
   * it, and one merely points at it, and showing all three as plain "cited"
   * overstates the last. The fixture carries all three so the difference is
   * visible in one screen.
   */
  assert.deepEqual(
    prov.body.blocks.map((b) => b.support).sort(),
    ["asserted", "quoted", "restated"],
    "the fixture must keep demonstrating all three strengths of citation",
  );
  const bySupport = Object.fromEntries(prov.body.blocks.map((b) => [b.support, b]));
  assert.equal(bySupport.quoted.score, 1);
  assert.ok(bySupport.restated.score >= 0.5 && bySupport.restated.score < 1, `unexpected ${bySupport.restated.score}`);
  assert.ok(bySupport.asserted.score < 0.5, "a link nothing in the wording supports must score low");

  // Strongest first, because the outline can only show one grade per paragraph
  // and must not pick the weakest of several by accident.
  const scores = prov.body.blocks.map((b) => b.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));

  const missing = await ctx.call("GET", `/api/courses/${courseId}/archives/src_nope`);
  assert.equal(missing.status, 404);
});

/**
 * The viewer is an iframe pointed at this endpoint, so the highlight has to be
 * in the HTML before it is served — nothing runs inside the frame to add it.
 */
test("the archived document is served with the cited passage marked", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const made = await ctx.call("POST", "/api/dev/fixture", {});
  const courseId = made.body.course.id;
  const view = await ctx.call("GET", `/api/courses/${courseId}/view`);
  const lessonId = view.body.course.units[0].lessons[0].id;
  const { body: prov } = await ctx.call("GET", `/api/courses/${courseId}/lessons/${lessonId}/provenance`);
  const hit = prov.blocks[0];

  const res = await fetch(
    `${ctx.base}/api/courses/${courseId}/archives/${hit.sourceId}/document?claim=${hit.claimId}`,
    { headers: { origin: ctx.base } },
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(res.headers.get("x-highlighted"), "1", "the quote must be found in the page it was checked against");

  const html = await res.text();
  assert.match(html, /<mark id="mh-cited"/, "and the anchor the frame scrolls to");
  assert.match(html, /<base href="https:\/\/example\.invalid/, "assets resolve against the origin");
  assert.ok(html.includes("lithium ions travel"), "the document itself is served, not a transcript");
});

test("deleting a course takes its archived sources with it", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const made = await ctx.call("POST", "/api/dev/fixture", {});
  const courseId = made.body.course.id;
  assert.equal((await ctx.store.getArchives(courseId)).length, 1);

  await ctx.call("DELETE", `/api/courses/${courseId}`);
  assert.deepEqual(await ctx.store.getArchives(courseId), [], "archives must not outlive the course");
});

/**
 * Blank lines are the wrong block unit on their own. A list is a single chunk by
 * that measure but renders as one element per item, so the key the server
 * produced matched no element in the document — the block was located in a
 * source and then silently marked nothing, which looks exactly like a lesson
 * with no sources. Found by opening a real lesson in a browser.
 */
test("a markdown list is keyed per item, the way it renders", () => {
  const markdown = [
    "Two halves of the same event:",
    "",
    "- **Oxidation**: loss of electrons; oxidation number goes up",
    "- **Reduction**: gain of electrons; oxidation number goes down",
  ].join("\n");

  const keys = proseBlocks(markdown).map(provenanceKey);
  assert.equal(keys.length, 3, "intro plus one block per list item");
  assert.ok(keys.includes(provenanceKey("Oxidation: loss of electrons; oxidation number goes up")));
  assert.ok(keys.includes(provenanceKey("Reduction: gain of electrons; oxidation number goes down")));
  assert.ok(
    !keys.some((k) => k.includes("goes up") && k.includes("goes down")),
    "no key may span two list items — no rendered element carries that text",
  );
});

test("a heading does not get folded into the paragraph under it", () => {
  const keys = proseBlocks("### Why it matters\nElectron transfer is the real event here.").map(provenanceKey);
  assert.ok(keys.includes(provenanceKey("Electron transfer is the real event here.")));
});

test("display math is not prose and is never counted as traceable", () => {
  const markdown = [
    "Lithium gives up an electron at the anode:",
    "",
    "$$\\text{Li} \\rightarrow \\text{Li}^+ + e^- \\qquad (0 \\rightarrow +1,\\ \\text{oxidation})$$",
    "",
    "That electron leaves through the external circuit.",
  ].join("\n");

  const blocks = proseBlocks(markdown).filter((b) => b.length >= 40);
  assert.ok(
    !blocks.some((b) => b.includes("rightarrow") || b.includes("text")),
    `LaTeX leaked into prose: ${JSON.stringify(blocks)}`,
  );
});

/**
 * The probe starts a real agent, so the only parts a test may touch are the
 * ones that refuse before anything is spawned. Both checks below run ahead of
 * `builder.start`, which is what makes them reachable for free — and the gate
 * order is itself the thing under test: a probe that validated after spawning
 * would bill the learner for a typo.
 */
test("the one-lesson probe is closed unless developer mode is on", async (t) => {
  const off = await bootApp({ devMode: false });
  t.after(() => off.cleanup());

  const { status } = await off.call("POST", "/api/dev/probe", { topic: "how tides work" });
  assert.equal(status, 403, "and refused before any agent is resolved or started");
});

test("the probe rejects a topic too short to build from, before spawning anything", async (t) => {
  const ctx = await bootApp({ devMode: true });
  t.after(() => ctx.cleanup());

  for (const topic of ["", " ", "x"]) {
    const { status } = await ctx.call("POST", "/api/dev/probe", { topic });
    assert.equal(status, 400, `"${topic}" should be refused`);
  }
});
