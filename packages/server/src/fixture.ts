import { gradeSupport, prefixedId, provenanceKey, proseBlocks, slugify, type ArchivedSource, type Course } from "@metaharness/core";

/**
 * A minimal course with its source already archived: one unit, one lesson, one
 * exercise, one source.
 *
 * Provenance is only visible on content that has sources behind it, so seeing
 * it work otherwise costs a real build — the wrong price for checking whether a
 * hover outline lands in the right place. This fixture is that content,
 * produced instantly with no agent involved.
 *
 * It is built the way the pipeline now builds courses: the source is archived
 * with its markup, facts are recorded as claims whose quotes appear word for
 * word in that markup, and each block of the lesson cites the claim it rests on.
 *
 * Its four paragraphs are the four things a reader can be shown, deliberately
 * side by side, because the whole point is that they must not look alike:
 *
 *   quoted    repeats the cited passage almost word for word
 *   restated  says it in other words, wording still traceable
 *   asserted  cited, but sharing almost no wording with the claim
 *   uncited   nobody vouched for it at all
 */

const SOURCE_URL = "https://example.invalid/how-a-lithium-ion-battery-works";

/** A page as a page — this is what the viewer renders in its frame. */
const ARCHIVED_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>How a Lithium-Ion Battery Works</title>
  <style>
    body { font: 16px/1.65 Georgia, serif; max-width: 44rem; margin: 0 auto; padding: 2.5rem 1.5rem; color: #1c1c1c; }
    h1 { font-size: 1.9rem; line-height: 1.2; }
    h2 { font-size: 1.25rem; margin-top: 2rem; color: #444; }
    nav { font: 13px/1.4 system-ui, sans-serif; color: #777; border-bottom: 1px solid #ddd; padding-bottom: .75rem; }
    figure { margin: 1.5rem 0; padding: 1rem; background: #f4f4f2; border-left: 3px solid #c9c9c4; }
    figcaption { font: 13px system-ui, sans-serif; color: #666; margin-top: .5rem; }
  </style>
</head>
<body>
  <nav>Home › Explained › Energy storage</nav>
  <h1>How a Lithium-Ion Battery Works</h1>
  <p>A lithium-ion cell stores energy by moving lithium ions back and forth between two electrodes.</p>

  <h2>Discharging</h2>
  <p>During discharge, lithium ions travel from the negative electrode, the anode, through the electrolyte to
  the positive electrode, the cathode, while electrons flow through the external circuit and do useful work.</p>

  <figure>
    <p>The cathode is typically a layered metal oxide such as lithium cobalt oxide, and the anode is usually
    graphite. A porous separator sits between the two electrodes and prevents direct electrical contact while
    still allowing ions to pass through.</p>
    <figcaption>Cell construction, simplified.</figcaption>
  </figure>

  <h2>Charging</h2>
  <p>Charging reverses the process. An external voltage drives lithium ions back into the graphite anode,
  where they sit between the carbon layers in a process called <strong>intercalation</strong>.</p>

  <h2>Thermal runaway</h2>
  <p>Overheating a cell can trigger thermal runaway, a self-sustaining reaction in which rising temperature
  accelerates the reactions that generate still more heat.</p>
</body>
</html>`;

/** What `extractText` produces from the markup above. */
const ARCHIVED_TEXT = [
  "Home › Explained › Energy storage",
  "How a Lithium-Ion Battery Works",
  "A lithium-ion cell stores energy by moving lithium ions back and forth between two electrodes.",
  "Discharging",
  "During discharge, lithium ions travel from the negative electrode, the anode, through the electrolyte to the positive electrode, the cathode, while electrons flow through the external circuit and do useful work.",
  "The cathode is typically a layered metal oxide such as lithium cobalt oxide, and the anode is usually graphite. A porous separator sits between the two electrodes and prevents direct electrical contact while still allowing ions to pass through.",
  "Cell construction, simplified.",
  "Charging",
  "Charging reverses the process. An external voltage drives lithium ions back into the graphite anode, where they sit between the carbon layers in a process called intercalation.",
  "Thermal runaway",
  "Overheating a cell can trigger thermal runaway, a self-sustaining reaction in which rising temperature accelerates the reactions that generate still more heat.",
].join("\n");

/** Blocks of the lesson, paired with the quote each one rests on. */
const BLOCKS: Array<{ markdown: string; quote?: string; claimText?: string; cites?: number }> = [
  {
    markdown:
      "During discharge, lithium ions travel from the negative electrode, the anode, through the electrolyte to the positive electrode, the cathode, while electrons flow through the external circuit and do useful work.",
    quote:
      "During discharge, lithium ions travel from the negative electrode, the anode, through the electrolyte to the positive electrode, the cathode, while electrons flow through the external circuit and do useful work.",
    claimText: "On discharge, ions move anode → cathode internally while electrons take the external circuit.",
  },
  {
    markdown:
      "Charging runs the whole thing backwards. An external voltage drives the lithium ions back into the graphite anode, where they settle between the carbon layers in a process called intercalation.",
    quote:
      "An external voltage drives lithium ions back into the graphite anode, where they sit between the carbon layers in a process called intercalation",
    claimText: "Charging drives ions back into the graphite anode, where they intercalate between carbon layers.",
  },
  {
    // Cited, but barely connected in wording: this is the case that used to be
    // indistinguishable from a direct quote. The author points at the discharge
    // claim while writing a sentence whose vocabulary is almost entirely its
    // own, so the grader can find nothing to confirm the link with.
    markdown:
      "Think of the whole cell as a see-saw: tip it one way and the charge carriers slide across to power whatever is attached, tip it back and they return to where they started.",
    cites: 0,
  },
  {
    // Deliberately uncited: nothing in the source supports it. This is what an
    // unvouched-for sentence looks like, and it must be visibly different.
    markdown:
      "Modern electric-car packs are assembled from thousands of individual cells wired into modules, and a battery management system watches each one so that no single cell is driven outside its safe voltage window.",
  },
];

export function provenanceFixture(): { course: Course; archive: ArchivedSource } {
  const now = new Date().toISOString();
  const claims = BLOCKS.filter((b) => b.quote).map((b) => ({
    id: prefixedId("clm", 8),
    text: b.claimText!,
    sourceUrl: SOURCE_URL,
    quote: b.quote!,
  }));

  let claimIndex = 0;
  const citations = BLOCKS.flatMap((block) => {
    // Either the block brings its own claim, or it points at one already made.
    const claim = block.quote ? claims[claimIndex++]! : block.cites !== undefined ? claims[block.cites]! : undefined;
    if (!claim) return [];
    // Keyed and graded exactly as the server does on a real write, so the
    // fixture shows the states a genuine build would produce rather than
    // whatever labels look good here.
    return proseBlocks(block.markdown).map((prose) => {
      const support = gradeSupport(prose, claim);
      return { block: provenanceKey(prose), claimId: claim.id, support: support.level, score: support.score };
    });
  });

  const course: Course = {
    id: prefixedId("crs"),
    slug: slugify("Source Check Test"),
    title: "Source Check Test",
    topic: "A fixture for checking source provenance in the lesson viewer",
    description:
      "One lesson, one exercise, one archived source. Two paragraphs are cited and open the page they came from; one is cited by nobody.",
    level: "beginner",
    status: "ready",
    curation: "manual",
    color: "#769826",
    buildConfig: {
      maxUnits: 1,
      maxLessonsPerUnit: 1,
      maxSources: 1,
      maxExercisesPerLesson: 3,
      skipResearch: true,
      authorAhead: 0,
    },
    createdAt: now,
    updatedAt: now,
    sources: [{ title: "How a Lithium-Ion Battery Works", url: SOURCE_URL, note: "Fixture source, archived locally." }],
    claims,
    researchNotes: "Fixture course. The archived page is stored locally; nothing is fetched.",
    units: [
      {
        id: prefixedId("unt"),
        title: "Provenance",
        description: "A single lesson whose paragraphs have known, checkable origins.",
        lessons: [
          {
            id: prefixedId("lsn"),
            title: "Inside a lithium-ion cell",
            objective: "Describe what moves where when a lithium-ion cell discharges and charges.",
            kind: "concept",
            notes: BLOCKS.map((b) => b.markdown).join("\n\n"),
            citations,
            authored: true,
            exercises: [
              {
                id: prefixedId("exr", 8),
                type: "multiple_choice",
                prompt: "During discharge, which way do the lithium ions move?",
                choices: [
                  "From the anode to the cathode",
                  "From the cathode to the anode",
                  "They stay put; only electrons move",
                  "They leave the cell entirely",
                ],
                answer: "From the anode to the cathode",
                explanation:
                  "Discharge sends ions from the negative electrode (anode) through the electrolyte to the positive electrode (cathode), while the electrons take the external circuit and do the work.",
                difficulty: 1,
                tags: ["discharge"],
              },
            ],
          },
        ],
      },
    ],
    lastBuild: { finishedAt: now, written: 1, total: 1, deferred: 0, ok: true, detail: "" },
  } as Course;

  const archive: ArchivedSource = {
    id: prefixedId("src"),
    url: SOURCE_URL,
    title: "How a Lithium-Ion Battery Works",
    fetchedAt: now,
    text: ARCHIVED_TEXT,
    html: ARCHIVED_HTML,
    ok: true,
  };

  return { course, archive };
}
