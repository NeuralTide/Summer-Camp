import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, gradeSupport, proseBlocks, provenanceKey } from "@metaharness/core";
import { createApp } from "../dist/index.js";
import { provenanceFixture } from "../dist/fixture.js";

/**
 * The ingestion contract: a fact is only recorded if the words said to support
 * it are really in the archived page, and a lesson is only written if every
 * paragraph names one of those facts.
 *
 * Nothing here runs an agent — these are the checks that stand between an agent
 * and the course, so they are exactly what must hold when a model is careless
 * or confabulating, and they are reachable without spending a single token.
 */
async function bootApp({ withClaims = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-cite-"));
  const store = new Store(dir);
  await store.init();

  // A course with an archived source but no claims yet — the state an agent is
  // in just after source_add.
  const { course, archive } = provenanceFixture();
  const blank = {
    ...course,
    claims: withClaims ? course.claims : [],
    units: course.units.map((u) => ({
      ...u,
      lessons: u.lessons.map((l) => ({ ...l, notes: "", exercises: [], citations: [], authored: false })),
    })),
  };
  const saved = await store.saveCourse(blank);
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
  const lessonId = saved.units[0].lessons[0].id;
  return {
    store,
    course: saved,
    lessonId,
    archive,
    call,
    async cleanup() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const REAL_QUOTE =
  "During discharge, lithium ions travel from the negative electrode, the anode, through the electrolyte to the positive electrode, the cathode";

const exercises = () => [
  {
    type: "multiple_choice",
    prompt: "Which way do ions move on discharge?",
    choices: ["Anode to cathode", "Cathode to anode"],
    answer: "Anode to cathode",
  },
  { type: "true_false", prompt: "Electrons take the external circuit.", answer: true },
  { type: "true_false", prompt: "Ions leave the cell entirely.", answer: false },
];

test("a claim whose quote is really in the source is accepted and given an id", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const { status, body } = await ctx.call("POST", `/api/courses/${ctx.course.id}/research`, {
    notes: "",
    claims: [{ text: "Ions move anode to cathode on discharge.", sourceUrl: ctx.archive.url, quote: REAL_QUOTE }],
  });

  assert.equal(status, 200);
  assert.equal(body.claims.length, 1);
  assert.match(body.claims[0].id, /^clm_/, "the id is what lesson_write will cite");
});

/**
 * The one behaviour the whole feature rests on. A model asked for a quote will
 * produce a fluent, plausible, entirely invented one — and if that is stored,
 * every downstream guarantee is theatre.
 */
test("an invented quote is refused, and the refusal says what was found instead", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const { status, body } = await ctx.call("POST", `/api/courses/${ctx.course.id}/research`, {
    claims: [
      {
        text: "Lithium-ion cells are 92% efficient.",
        sourceUrl: ctx.archive.url,
        // Nothing like this appears in the archived page.
        quote: "Lithium-ion cells achieve a round-trip efficiency of 92 percent under laboratory conditions.",
      },
    ],
  });

  assert.equal(status, 400);
  assert.match(body.detail ?? "", /not in/i);
  assert.equal(ctx.store.getCourse(ctx.course.id).claims.length, 0, "and nothing is stored");
});

test("a claim against a source that was never archived is refused", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const { status, body } = await ctx.call("POST", `/api/courses/${ctx.course.id}/research`, {
    claims: [{ text: "Something.", sourceUrl: "https://example.invalid/never-fetched", quote: REAL_QUOTE }],
  });

  assert.equal(status, 400);
  assert.match(body.detail ?? "", /no archived copy/i);
});

/** One bad claim must not smuggle itself in beside a good one. */
test("a batch with one bad claim stores none of them", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const { status } = await ctx.call("POST", `/api/courses/${ctx.course.id}/research`, {
    claims: [
      { text: "Real.", sourceUrl: ctx.archive.url, quote: REAL_QUOTE },
      { text: "Invented.", sourceUrl: ctx.archive.url, quote: "Every cell contains a small quantity of liquid sodium." },
    ],
  });

  assert.equal(status, 400);
  assert.equal(ctx.store.getCourse(ctx.course.id).claims.length, 0);
});

test("a lesson whose prose cites nothing is refused, and is told which blocks", async (t) => {
  const ctx = await bootApp({ withClaims: true });
  t.after(() => ctx.cleanup());

  const { status, body } = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}`, {
    blocks: [
      {
        markdown:
          "A lithium-ion cell moves charge by moving ions between two electrodes suspended in an electrolyte solution.",
        cites: [],
      },
    ],
    exercises: exercises(),
  });

  assert.equal(status, 400);
  assert.match(body.detail ?? "", /blocks\[0\]/, "the agent is told exactly which block to fix");
  assert.match(body.detail ?? "", /clm_/, "and which claims it has to choose from");
  assert.equal(ctx.store.getCourse(ctx.course.id).units[0].lessons[0].authored, false, "nothing is written");
});

test("a lesson citing a claim that does not exist is refused", async (t) => {
  const ctx = await bootApp({ withClaims: true });
  t.after(() => ctx.cleanup());

  const { status, body } = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}`, {
    blocks: [{ markdown: "Ions move from the anode to the cathode while electrons do work.", cites: ["clm_invented"] }],
    exercises: exercises(),
  });

  assert.equal(status, 400);
  assert.match(body.detail ?? "", /no claim with id/i);
});

test("a properly cited lesson is written, and its citations survive to the reader", async (t) => {
  const ctx = await bootApp({ withClaims: true });
  t.after(() => ctx.cleanup());
  const claimId = ctx.store.getCourse(ctx.course.id).claims[0].id;

  const written = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}`, {
    blocks: [
      { markdown: "## Discharging", cites: [] },
      {
        markdown: "Ions travel from the anode to the cathode while the electrons go the long way round and do work.",
        cites: [claimId],
      },
    ],
    exercises: exercises(),
  });
  assert.equal(written.status, 200);

  const prov = await ctx.call("GET", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}/provenance`);
  assert.equal(prov.body.verified, true);
  assert.equal(prov.body.blocks.length, 1, "the heading needs no citation and gets none");
  assert.equal(prov.body.blocks[0].claimId, claimId);
  assert.ok(
    prov.body.blocks[0].quote.startsWith(REAL_QUOTE),
    "the reader gets the quote the claim was verified against, not a re-derived one",
  );
});

/**
 * A build with research switched off has no claims by design. Demanding
 * citations there would reject every lesson and fail the whole build over a
 * mode the learner chose on purpose.
 */
test("a course with no claims at all is written without citations", async (t) => {
  const ctx = await bootApp();
  t.after(() => ctx.cleanup());

  const { status } = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}`, {
    blocks: [{ markdown: "A lithium-ion cell moves charge by moving ions between two electrodes.", cites: [] }],
    exercises: exercises(),
  });

  assert.equal(status, 200, "research-free courses must still be buildable");
  const prov = await ctx.call("GET", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}/provenance`);
  assert.equal(prov.body.verified, false, "and they claim nothing, which is the honest result");
});

/**
 * Citations are (block, claim) pairs, so a paragraph resting on two claims
 * arrives as two entries sharing one key. Any coverage count must therefore be
 * taken over distinct keys — counting entries reports 2 of 1 paragraphs cited,
 * which is the precise species of overstatement this feature exists to stop.
 */
test("a paragraph resting on two claims is still one paragraph", async (t) => {
  const ctx = await bootApp({ withClaims: true });
  t.after(() => ctx.cleanup());

  const claims = ctx.store.getCourse(ctx.course.id).claims;
  assert.ok(claims.length >= 2, "the fixture needs two claims for this to mean anything");

  const written = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}`, {
    blocks: [
      {
        markdown: "Ions move one way on discharge and back again on charge, settling between the carbon layers.",
        cites: [claims[0].id, claims[1].id],
      },
    ],
    exercises: exercises(),
  });
  assert.equal(written.status, 200);

  const { body } = await ctx.call("GET", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}/provenance`);
  assert.equal(body.blocks.length, 2, "two citations, as sent");
  assert.equal(new Set(body.blocks.map((b) => b.key)).size, 1, "but one paragraph");
  assert.equal(body.proseCount, 1);
});

/**
 * The second link in the chain.
 *
 * A claim's quote is *verified* — the server found those words in the archived
 * page. Which paragraph rests on which claim is the model's assertion, checked
 * by nobody, and it was being displayed at the same strength as the verified
 * half. Grading it is what keeps a paragraph that merely points at a quote from
 * being shown as one that repeats it.
 */
test("the wording link between a paragraph and its claim is graded, not assumed", () => {
  const claim = {
    text: "On discharge, ions move anode to cathode while electrons take the external circuit.",
    quote:
      "During discharge, lithium ions travel from the negative electrode, the anode, through the electrolyte to the positive electrode, the cathode, while electrons flow through the external circuit and do useful work.",
  };

  const lifted = gradeSupport(claim.quote, claim);
  assert.equal(lifted.level, "quoted");
  assert.equal(lifted.score, 1);

  const restated = gradeSupport(
    "On discharge the lithium ions move from the anode through the electrolyte to the cathode, while the electrons travel the external circuit and do the work.",
    claim,
  );
  assert.equal(restated.level, "restated");

  // Same subject, none of the claim's substance — the honest answer is that
  // nothing here confirms the link, not that the citation is wrong.
  const loose = gradeSupport(
    "Think of the whole cell as a see-saw: tip it one way and the charge carriers slide across to power whatever is attached.",
    claim,
  );
  assert.equal(loose.level, "asserted");
  assert.ok(loose.score < 0.5);

  assert.equal(gradeSupport("The Treaty of Westphalia ended the Thirty Years War.", claim).level, "asserted");
});

/**
 * Measured against the block's own vocabulary, not the claim's. A paragraph
 * that quotes one sentence of a long claim is fully supported; a paragraph that
 * quotes the claim and then adds an unsourced sentence is not, and the grade has
 * to fall for the second case and not the first.
 */
test("grading asks whether the paragraph is covered, not whether it repeats everything", () => {
  const claim = {
    text: "Charging drives ions back into the graphite anode, where they intercalate.",
    quote:
      "Charging reverses the process. An external voltage drives lithium ions back into the graphite anode, where they sit between the carbon layers in a process called intercalation.",
  };

  const partial = gradeSupport("An external voltage drives lithium ions back into the graphite anode.", claim);
  assert.equal(partial.level, "quoted", "saying less than the claim is still fully supported by it");

  const padded = gradeSupport(
    "An external voltage drives lithium ions back into the graphite anode. Fast chargers can refill a pack to eighty percent in under twenty minutes using liquid cooling.",
    claim,
  );
  assert.ok(padded.score < partial.score, "an added unsourced sentence must lower the grade");
});

test("a lesson records the grade it was written with", async (t) => {
  const ctx = await bootApp({ withClaims: true });
  t.after(() => ctx.cleanup());
  const claim = ctx.store.getCourse(ctx.course.id).claims[0];

  const written = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}`, {
    blocks: [
      { markdown: claim.quote, cites: [claim.id] },
      { markdown: "Picture the cell as a see-saw that tips back and forth to move charge around a loop.", cites: [claim.id] },
    ],
    exercises: exercises(),
  });
  assert.equal(written.status, 200);

  const stored = ctx.store.getCourse(ctx.course.id).units[0].lessons[0].citations;
  const grades = stored.map((c) => c.support).sort();
  assert.deepEqual(grades, ["asserted", "quoted"], "both blocks cite the same claim at very different strengths");
});

/**
 * Courses written between the citation pipeline landing and the grader landing
 * carry real, verified citations with no grade attached. Left at a default they
 * would every one of them read as "cited, not quoted" — the weakest label in the
 * set, applied wholesale to a course nobody had actually examined. Grading them
 * on read costs nothing and needs no rebuild, so an ungraded citation is treated
 * as a measurement waiting to happen rather than a measurement that came back empty.
 */
test("a citation written before grading existed is graded on the way out", async (t) => {
  const ctx = await bootApp({ withClaims: true });
  t.after(() => ctx.cleanup());
  const claim = ctx.store.getCourse(ctx.course.id).claims[0];

  // Exactly what such a course holds: block and claimId, and nothing else.
  await ctx.store.updateCourse(ctx.course.id, (c) => ({
    ...c,
    units: c.units.map((u) => ({
      ...u,
      lessons: u.lessons.map((l) => ({
        ...l,
        authored: true,
        notes: `${claim.quote}\n\nPicture the cell as a see-saw tipping charge back and forth around a loop.`,
        citations: [
          { block: provenanceKey(proseBlocks(claim.quote)[0]), claimId: claim.id },
          {
            block: provenanceKey("Picture the cell as a see-saw tipping charge back and forth around a loop."),
            claimId: claim.id,
          },
        ],
      })),
    })),
  }));

  const stored = ctx.store.getCourse(ctx.course.id).units[0].lessons[0].citations;
  assert.equal(stored[0].support, undefined, "nothing may be invented at rest — absent stays absent");

  const { body } = await ctx.call("GET", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}/provenance`);
  assert.deepEqual(
    body.blocks.map((b) => b.support).sort(),
    ["asserted", "quoted"],
    "and the reader is shown the real spread, not one flat default",
  );
});

test("a grade recorded at write time is not recomputed later", async (t) => {
  const ctx = await bootApp({ withClaims: true });
  t.after(() => ctx.cleanup());
  const claim = ctx.store.getCourse(ctx.course.id).claims[0];

  await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}`, {
    blocks: [{ markdown: claim.quote, cites: [claim.id] }],
    exercises: exercises(),
  });

  // Stand a deliberately wrong grade in the file. A read must report it rather
  // than quietly re-deriving one: the stored grade describes the lesson as it
  // was written, and a retuned grader must not relabel shipped courses.
  await ctx.store.updateCourse(ctx.course.id, (c) => ({
    ...c,
    units: c.units.map((u) => ({
      ...u,
      lessons: u.lessons.map((l) => ({
        ...l,
        citations: l.citations.map((cite) => ({ ...cite, support: "restated", score: 0.61 })),
      })),
    })),
  }));

  const { body } = await ctx.call("GET", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}/provenance`);
  assert.equal(body.blocks[0].support, "restated");
  assert.equal(body.blocks[0].score, 0.61);
});

/**
 * The summary line's denominator has to count the same paragraphs its numerator
 * does. A lesson that cites short list items reported "8 of 5 paragraphs cited"
 * — impossible on its face, and in a feature whose entire value is not
 * overstating itself. Headings must stay out of the count; anything the author
 * vouched for must stay in, however short.
 */
test("the cited count can never exceed the paragraph count", async (t) => {
  const ctx = await bootApp({ withClaims: true });
  t.after(() => ctx.cleanup());
  const claim = ctx.store.getCourse(ctx.course.id).claims[0];

  const written = await ctx.call("POST", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}`, {
    blocks: [
      { markdown: "## What moves", cites: [] },
      { markdown: "- Lithium ions — from the anode", cites: [claim.id] },
      { markdown: "- Electrons — around the external circuit", cites: [claim.id] },
      { markdown: claim.quote, cites: [claim.id] },
    ],
    exercises: exercises(),
  });
  assert.equal(written.status, 200);

  const { body } = await ctx.call("GET", `/api/courses/${ctx.course.id}/lessons/${ctx.lessonId}/provenance`);
  const cited = new Set(body.blocks.map((b) => b.key)).size;
  assert.equal(cited, 3, "both short list items and the long paragraph are cited");
  assert.ok(cited <= body.proseCount, `reported ${cited} of ${body.proseCount}`);
  assert.equal(body.proseCount, 3, "and the heading, which needs no source, is not counted against them");
});
