#!/usr/bin/env node
import { CourseSchema, Store, formatZodError, prefixedId, slugify, type Course } from "@metaharness/core";

/**
 * A hand-written demo course.
 *
 * Its job is to make the app playable the moment it starts — before any agent has
 * run, and without spending a token. It is also the reference for what
 * agent-authored content should look like: every exercise type appears at least
 * once, distractors encode real misconceptions, and every answer has an
 * explanation.
 */

function ex(input: Record<string, unknown>) {
  return { id: prefixedId("exr", 8), difficulty: 2, tags: [], ...input };
}

export function ferrofluidCourse(): Course {
  const now = new Date().toISOString();

  const draft = {
    id: prefixedId("crs"),
    slug: slugify("Ferrofluids"),
    title: "Ferrofluids",
    topic: "How ferrofluids work: magnetism, surfactants, and spikes",
    description:
      "Why a liquid can be attracted to a magnet, and why it grows spikes when you bring one close. Covers the magnetic, chemical, and fluid-mechanical pieces, and where the effect is actually used.",
    level: "beginner" as const,
    status: "ready" as const,
    color: "#7c5cff",
    createdAt: now,
    updatedAt: now,
    sources: [
      { title: "Rosensweig, Ferrohydrodynamics", note: "The standard reference for the instability and its threshold." },
      { title: "NASA Glenn — ferrofluid seals", note: "Practical engineering uses." },
    ],
    researchNotes:
      "Ferrofluids are colloidal suspensions of ~10 nm magnetite particles in a carrier liquid, coated in a surfactant that keeps them from clumping. They are superparamagnetic, not ferromagnetic: they magnetise strongly in a field but retain no magnetisation when it is removed, because thermal motion randomises the particle moments. The Rosensweig (normal-field) instability produces the spike pattern when magnetic pressure exceeds the combined restoring effect of surface tension and gravity.",
    units: [
      {
        id: prefixedId("unt", 6),
        title: "What a ferrofluid is",
        description: "The three ingredients, and why each one is necessary.",
        lessons: [
          {
            id: prefixedId("lsn", 6),
            title: "A liquid that feels magnets",
            objective: "Describe the three components of a ferrofluid and the job each one does.",
            kind: "concept" as const,
            authored: true,
            notes: `A ferrofluid is not a magnetic liquid in the way iron is a magnetic solid. It is a **suspension**: billions of solid magnetic particles floating in an ordinary liquid.

Three ingredients, each solving a problem:

1. **Magnetic nanoparticles** — usually magnetite, $\\mathrm{Fe_3O_4}$, about 10 nm across. These are what the magnet actually pulls on.
2. **A carrier liquid** — oil, water, or kerosene. This is what makes the whole thing flow.
3. **A surfactant** — a coating on each particle. Without it the particles stick together, and you get magnetic sludge instead of a fluid.

The size matters enormously. At 10 nm, each particle is a *single magnetic domain* — one tiny bar magnet. It is also small enough that random thermal jostling keeps it suspended indefinitely rather than settling out under gravity.

A useful comparison: a 10 nm particle is roughly 1/8000th the width of a red blood cell. Scale it up to sand-grain size and the suspension collapses in seconds.`,
            exercises: [
              ex({
                type: "multiple_choice",
                prompt: "What is the job of the surfactant coating in a ferrofluid?",
                choices: [
                  "It stops the particles clumping together",
                  "It makes the particles magnetic",
                  "It thickens the carrier liquid",
                  "It dissolves the particles into the liquid",
                ],
                answer: "It stops the particles clumping together",
                explanation:
                  "Magnetic particles attract each other. The surfactant creates a physical barrier that keeps them apart, so the suspension stays fluid instead of clumping into sludge.",
                tags: ["surfactant", "composition"],
                difficulty: 1,
              }),
              ex({
                type: "categorize",
                prompt: "Sort each item by the role it plays in a ferrofluid.",
                categories: ["Magnetic particle", "Carrier liquid", "Surfactant"],
                items: [
                  { text: "Magnetite (Fe₃O₄)", category: "Magnetic particle" },
                  { text: "Kerosene", category: "Carrier liquid" },
                  { text: "Oleic acid", category: "Surfactant" },
                  { text: "Water", category: "Carrier liquid" },
                  { text: "Cobalt ferrite", category: "Magnetic particle" },
                ],
                explanation:
                  "Two of these are iron-based magnetic solids, two are ordinary liquids, and oleic acid is the classic coating molecule.",
                tags: ["composition"],
              }),
              ex({
                type: "fill_blank",
                prompt: "Ferrofluid particles are about ___ nanometres across, which makes each one a single magnetic ___.",
                blanks: [{ accepted: ["10", "ten"] }, { accepted: ["domain"] }],
                wordBank: ["10", "domain", "1000", "crystal", "atom"],
                explanation:
                  "Below roughly 20 nm a magnetite particle cannot support more than one domain, so it behaves as one indivisible magnetic moment.",
                tags: ["nanoparticles", "domains"],
              }),
              ex({
                type: "true_false",
                prompt: "If you scaled ferrofluid particles up to the size of sand grains, the fluid would work the same way.",
                answer: false,
                explanation:
                  "It would not. Thermal motion is what keeps nanoparticles suspended; sand-sized particles are far too heavy and would settle out under gravity within seconds.",
                tags: ["nanoparticles"],
                difficulty: 2,
              }),
              ex({
                type: "short_answer",
                prompt: "Why does a ferrofluid stay mixed instead of the particles settling to the bottom?",
                keyPoints: [
                  "thermal motion / Brownian motion keeps the particles suspended",
                  "the particles are extremely small, so gravity has little effect on them",
                ],
                exemplar:
                  "The particles are only about 10 nm across, so random thermal (Brownian) motion constantly knocks them around, and that agitation overwhelms the weak pull of gravity on something that small. The surfactant also stops them clumping into larger, heavier lumps that would settle.",
                minWords: 12,
                explanation:
                  "Two effects combine: the particles are small enough for thermal motion to dominate gravity, and the surfactant prevents them aggregating into heavier clumps.",
                tags: ["nanoparticles", "suspension"],
                difficulty: 3,
              }),
            ],
          },
          {
            id: prefixedId("lsn", 6),
            title: "Magnetised, but with no memory",
            objective: "Explain why ferrofluids are superparamagnetic rather than ferromagnetic.",
            kind: "concept" as const,
            authored: true,
            notes: `Bring a magnet to a ferrofluid and it responds strongly. Take the magnet away and the fluid keeps *no* magnetism at all. A fridge magnet does not behave like this — once magnetised, it stays magnetised.

The difference is called **superparamagnetism**.

Each nanoparticle is permanently magnetic. But it is so small that random thermal energy is enough to flip its magnetic direction, spontaneously, many times a second. With no external field, all those moments point in random directions and cancel out. Net magnetisation: zero.

Apply a field and the moments line up, giving a strong response — a magnetic susceptibility far higher than ordinary paramagnets, hence "super". Remove the field and thermal flipping randomises them again within microseconds.

So the *particles* are ferromagnetic. The *fluid* is superparamagnetic. The property belongs to the collection, not the ingredient.`,
            exercises: [
              ex({
                type: "multiple_choice",
                prompt: "Why does a ferrofluid lose all its magnetisation the instant you remove the external field?",
                choices: [
                  "Thermal motion randomises the direction of each particle's magnetic moment",
                  "The particles lose their magnetism permanently after being used once",
                  "The surfactant coating cancels out the magnetic field",
                  "The carrier liquid conducts the magnetism away",
                ],
                answer: "Thermal motion randomises the direction of each particle's magnetic moment",
                explanation:
                  "The particles stay magnetic individually. What disappears is their *alignment* — thermal energy scrambles their directions so the moments cancel.",
                tags: ["superparamagnetism"],
              }),
              ex({
                type: "match_pairs",
                prompt: "Match each material to how it behaves magnetically.",
                pairs: [
                  { left: "Ferrofluid", right: "Strong response, no memory" },
                  { left: "Fridge magnet", right: "Stays magnetised permanently" },
                  { left: "Aluminium", right: "Barely responds at all" },
                  { left: "Copper", right: "Weakly repelled by a magnet" },
                ],
                explanation:
                  "Superparamagnetic, ferromagnetic, paramagnetic, and diamagnetic respectively — a spectrum from strong-with-memory to weak-and-repelled.",
                tags: ["superparamagnetism", "magnetism"],
                difficulty: 3,
              }),
              ex({
                type: "true_false",
                prompt: "The individual nanoparticles inside a ferrofluid are themselves superparamagnetic.",
                answer: false,
                explanation:
                  "The particles are ferromagnetic — each is a permanent single-domain magnet. Superparamagnetism describes the behaviour of the whole collection, where thermal flipping averages the moments to zero.",
                tags: ["superparamagnetism"],
                difficulty: 3,
              }),
              ex({
                type: "fill_blank",
                prompt: "With no applied field the particle moments point in ___ directions, so the net magnetisation is ___.",
                blanks: [{ accepted: ["random", "randomised", "randomized"] }, { accepted: ["zero", "0", "nil"] }],
                explanation: "Random orientation means the vector sum of billions of moments cancels to nothing.",
                tags: ["superparamagnetism"],
                difficulty: 1,
              }),
              ex({
                type: "flashcard",
                prompt: "Superparamagnetism",
                back: "Strong magnetic response under an applied field, but zero remanent magnetisation once the field is removed — because thermal energy randomises the moments of single-domain nanoparticles.",
                tags: ["superparamagnetism"],
              }),
            ],
          },
          {
            id: prefixedId("lsn", 6),
            title: "Checkpoint: the basics",
            objective: "Confirm you can explain what a ferrofluid is made of and how it responds to a field.",
            kind: "checkpoint" as const,
            authored: true,
            notes: `A quick check on Unit 1 before moving to the spikes.

You should be able to name the three ingredients and say what each does, and explain why the fluid responds strongly to a magnet but keeps nothing afterwards.`,
            exercises: [
              ex({
                type: "multi_select",
                prompt: "Which of these are true of ferrofluids?",
                choices: [
                  "The particles are around 10 nm across",
                  "They keep their magnetisation after the field is removed",
                  "A surfactant prevents the particles clumping",
                  "They respond strongly to an applied magnetic field",
                  "The particles are dissolved in the carrier liquid",
                ],
                answers: [
                  "The particles are around 10 nm across",
                  "A surfactant prevents the particles clumping",
                  "They respond strongly to an applied magnetic field",
                ],
                explanation:
                  "They keep no magnetisation (that is the 'super' in superparamagnetic), and the particles are suspended, not dissolved — a colloid, not a solution.",
                tags: ["composition", "superparamagnetism"],
                difficulty: 3,
              }),
              ex({
                type: "order_sequence",
                prompt: "Put the steps of making a ferrofluid in order.",
                items: [
                  "Precipitate magnetite nanoparticles from iron salts",
                  "Coat each particle with surfactant",
                  "Disperse the coated particles in the carrier liquid",
                  "Remove any oversized particles that would settle",
                ],
                explanation:
                  "Coating comes before dispersal: uncoated particles would clump the moment they were concentrated together.",
                tags: ["synthesis"],
                difficulty: 3,
              }),
              ex({
                type: "multiple_choice",
                prompt: "A ferrofluid sample has been left on a shelf for a year and has separated into a clear liquid with dark sludge underneath. What most likely failed?",
                choices: [
                  "The surfactant coating degraded, letting particles aggregate",
                  "The particles lost their magnetism over time",
                  "The carrier liquid evaporated",
                  "The magnetite oxidised into a non-magnetic form",
                ],
                answer: "The surfactant coating degraded, letting particles aggregate",
                explanation:
                  "Separation is a colloid-stability failure. Once particles clump, they become heavy enough for gravity to beat thermal motion and they settle out.",
                tags: ["surfactant", "suspension"],
                difficulty: 3,
              }),
            ],
          },
        ],
      },
      {
        id: prefixedId("unt", 6),
        title: "The spikes",
        description: "The Rosensweig instability — the effect everyone knows ferrofluids for.",
        lessons: [
          {
            id: prefixedId("lsn", 6),
            title: "Why spikes form",
            objective: "Explain the force balance that produces the spike pattern.",
            kind: "concept" as const,
            authored: true,
            notes: `Put a strong magnet under a pool of ferrofluid and the flat surface erupts into a field of neat spikes. This is the **Rosensweig instability**, or normal-field instability.

Three forces compete at the surface:

- **Magnetic pressure** pushes the fluid *up* along the field lines. Field lines concentrate where the fluid rises, which pulls even more fluid up — a runaway.
- **Surface tension** resists, because spikes have far more surface area than a flat pool.
- **Gravity** resists, because spikes lift mass upward.

Below a critical field strength the restoring forces win and the surface stays flat. Above it, magnetic pressure wins and the surface breaks up.

Why a regular pattern rather than one big spike? Splitting into many spikes minimises the total energy. The characteristic spacing is set by the balance of surface tension and gravity:

$$\\lambda_c = 2\\pi\\sqrt{\\frac{\\sigma}{\\rho g}}$$

where $\\sigma$ is surface tension and $\\rho$ is density. For a typical ferrofluid that gives spikes a few millimetres apart — which is exactly what you see.`,
            exercises: [
              ex({
                type: "multiple_choice",
                prompt: "Which pair of forces resists spike formation?",
                choices: [
                  "Surface tension and gravity",
                  "Magnetic pressure and gravity",
                  "Surface tension and magnetic pressure",
                  "Viscosity and magnetic pressure",
                ],
                answer: "Surface tension and gravity",
                explanation:
                  "Magnetic pressure is the driving force; surface tension and gravity both act to flatten the surface back down.",
                tags: ["rosensweig", "forces"],
              }),
              ex({
                type: "fill_blank",
                prompt: "Spikes appear once ___ pressure exceeds the combined effect of surface ___ and gravity.",
                blanks: [{ accepted: ["magnetic"] }, { accepted: ["tension"] }],
                wordBank: ["magnetic", "tension", "osmotic", "viscosity", "atmospheric"],
                explanation: "That threshold is the critical field for the normal-field instability.",
                tags: ["rosensweig"],
                difficulty: 1,
              }),
              ex({
                type: "multiple_choice",
                prompt: "Why does the surface break into many small spikes rather than one large mound?",
                choices: [
                  "Many spikes give a lower total energy than one large deformation",
                  "The magnet has many separate poles",
                  "The particles repel each other into a lattice",
                  "Air currents break up the larger mound",
                ],
                answer: "Many spikes give a lower total energy than one large deformation",
                explanation:
                  "The pattern is an energy minimum. Spacing is set by the competition between surface tension and gravity, giving the characteristic wavelength λc.",
                tags: ["rosensweig", "pattern"],
                difficulty: 3,
              }),
              ex({
                type: "true_false",
                prompt: "Increasing the ferrofluid's surface tension would make spikes form at a lower field strength.",
                answer: false,
                explanation:
                  "Higher surface tension resists deformation more strongly, so you need a *stronger* field to reach the instability threshold.",
                tags: ["rosensweig", "forces"],
                difficulty: 3,
              }),
              ex({
                type: "short_answer",
                prompt: "Explain why spike formation is described as a runaway process once it starts.",
                keyPoints: [
                  "a rising bump concentrates the magnetic field lines",
                  "the stronger local field pulls up more fluid, reinforcing the bump",
                ],
                exemplar:
                  "Where the surface bulges upward, the field lines crowd together into the ferrofluid, so the local field gets stronger. A stronger field pulls that bump up harder still, which concentrates the field further. It is positive feedback, so once the magnetic force beats surface tension and gravity the bump grows away until it forms a spike.",
                minWords: 15,
                explanation:
                  "The feedback loop is the key: deformation concentrates the field, and a concentrated field increases deformation.",
                tags: ["rosensweig", "feedback"],
                difficulty: 3,
              }),
            ],
          },
          {
            id: prefixedId("lsn", 6),
            title: "Where ferrofluids are actually used",
            objective: "Identify real applications and the property each one exploits.",
            kind: "concept" as const,
            authored: true,
            notes: `The spikes are a demo. The commercial uses are quieter and mostly invisible.

**Rotary seals.** A ring of ferrofluid held in place by a magnet forms a liquid gasket around a spinning shaft. It seals against pressure while offering almost no friction, and cannot wear out the way a rubber seal does. Hard drives used these for decades.

**Loudspeaker cooling.** Ferrofluid sits in the voice-coil gap, held by the speaker's own magnet. It conducts heat away from the coil far better than air, letting the speaker take more power, and it damps unwanted cone resonance at the same time.

**Vibration damping.** A magnetically positioned fluid whose effective viscosity changes with applied field gives you a damper that can be tuned electronically.

**Medicine.** Magnetic nanoparticles can be steered to a tumour site and heated with an alternating field — magnetic hyperthermia. Related particles are used as MRI contrast agents.

The common thread: a ferrofluid lets you apply *force to a liquid at a distance*, with no mechanical contact.`,
            exercises: [
              ex({
                type: "match_pairs",
                prompt: "Match each application to the property it relies on.",
                pairs: [
                  { left: "Rotary shaft seal", right: "Held in place by a magnet, near-frictionless" },
                  { left: "Loudspeaker gap", right: "Conducts heat better than air" },
                  { left: "Tunable damper", right: "Effective viscosity changes with field" },
                  { left: "Magnetic hyperthermia", right: "Heats up under an alternating field" },
                ],
                explanation:
                  "Each use exploits a different consequence of being a liquid you can control magnetically.",
                tags: ["applications"],
              }),
              ex({
                type: "multiple_choice",
                prompt: "What is the main advantage of a ferrofluid seal over a conventional rubber seal?",
                choices: [
                  "It has almost no friction and nothing to wear out",
                  "It is much cheaper to manufacture",
                  "It works at any temperature without limit",
                  "It seals against gases but not liquids",
                ],
                answer: "It has almost no friction and nothing to wear out",
                explanation:
                  "The seal is liquid, so there is no contacting solid surface to abrade. That is why it suited continuously spinning hard-drive spindles.",
                tags: ["applications", "seals"],
              }),
              ex({
                type: "multi_select",
                prompt: "Which properties make ferrofluid useful in a loudspeaker's voice-coil gap?",
                choices: [
                  "It conducts heat away from the coil",
                  "It damps unwanted cone resonance",
                  "It is held in place by the speaker's existing magnet",
                  "It amplifies the magnetic field of the coil",
                  "It makes the cone lighter",
                ],
                answers: [
                  "It conducts heat away from the coil",
                  "It damps unwanted cone resonance",
                  "It is held in place by the speaker's existing magnet",
                ],
                explanation:
                  "It cools, damps, and stays put for free. It does not amplify the field, and it adds mass rather than removing it.",
                tags: ["applications", "speakers"],
                difficulty: 3,
              }),
              ex({
                type: "true_false",
                prompt: "Ferrofluid seals were widely used in computer hard drives.",
                answer: true,
                explanation:
                  "They sealed the spindle where it entered the sealed disk enclosure, keeping contaminants out without adding friction to a continuously spinning shaft.",
                tags: ["applications", "seals"],
                difficulty: 1,
              }),
            ],
          },
        ],
      },
    ],
  };

  const parsed = CourseSchema.safeParse(draft);
  if (!parsed.success) {
    // The seed doubles as a schema regression test: if the shape drifts, fail loudly.
    throw new Error(`Seed course does not satisfy the schema:\n${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const store = new Store(process.env.METAHARNESS_DIR);
  await store.init();
  const course = ferrofluidCourse();
  const existing = store.listCourses().find((c) => c.title === course.title);
  if (existing) {
    console.log(`A course titled "${course.title}" already exists (${existing.id}). Nothing to do.`);
  } else {
    await store.saveCourse(course);
    const lessons = course.units.reduce((n, u) => n + u.lessons.length, 0);
    console.log(`Seeded "${course.title}" — ${course.units.length} units, ${lessons} lessons, into ${store.dir}`);
  }
}
