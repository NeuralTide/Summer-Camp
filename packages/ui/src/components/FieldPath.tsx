import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconBook, IconCheck, IconDumbbell, IconLock, IconStar } from "./Icons";
import boulderAsset from "../assets/scenery/boulder.svg";
import campfireAsset from "../assets/scenery/campfire.svg";
import canoeAsset from "../assets/scenery/canoe.svg";
import pineAsset from "../assets/scenery/pine.svg";
import tentAsset from "../assets/scenery/tent.svg";
import type { CourseTree, LessonNode, UnitStub } from "../lib/types";

/**
 * The lesson path: a gently zigzagging column of nodes, one per lesson. Tapping
 * an unlocked node opens a small popup with the lesson's objective and a Start
 * button, rather than navigating immediately — a beat of confirmation before
 * committing hearts to an attempt.
 */

/** Nodes per full wave. 7 is the smallest count that samples a sine without
 *  landing on repeated values (6 pairs every offset, which flattens the
 *  shoulders into two nodes at the same x and a dead-straight run between). */
const WAVE_PERIOD = 7;

/** Matches the `var(--wobble-max, 90px)` fallback in app.css. */
const DEFAULT_WOBBLE_MAX = 90;

/**
 * Where the node sits on the wave, as a signed fraction (-1 … 1) of the row's
 * available half-width rather than a pixel offset. CSS multiplies it by
 * --wobble-max, so a narrow breakpoint gets the same sine drawn *smaller*
 * instead of the same sine clipped — the old pixel-plus-clamp arrangement
 * squared off every peak once the amplitude exceeded the breakpoint ceiling,
 * turning the wave into a trapezoid on mobile.
 */
function waveOffset(index: number): number {
  return Number(Math.sin((index / WAVE_PERIOD) * Math.PI * 2).toFixed(4));
}

/**
 * The fill luminance at which this palette's ink and paper are equally
 * readable on top of it: sqrt((Lpaper + 0.05) * (Link + 0.05)) - 0.05, where
 * the two WCAG contrast curves cross. Always taking the better side of it puts
 * the floor at ~3.9:1, which clears the 3:1 a glyph this size needs.
 */
const GLYPH_CROSSOVER = 0.1854;

/**
 * The trail paints camp green, not the course's own colour.
 *
 * Course accents are arbitrary hex chosen by whichever agent planned the
 * course — Python's brand blue, a stock lime — and none of them belong to the
 * paper/ink/pine palette. That put a blue run of gumdrops directly under a
 * green-ledged unit sign, on a page whose every other accent is fir. The
 * colour still identifies a course wherever it names one: the monogram chips,
 * the library rows, the profile. The path itself is camp furniture, and camp
 * furniture is green.
 *
 * Held in sync with --accent in app.css by hand. It has to be a real hex
 * rather than var(--accent) because glyphOn() below measures contrast against
 * it, and a custom property is an opaque token to JS.
 */
const PATH_ACCENT = "#769826";

/**
 * Ink or paper, whichever reads on the given fill. The current node is the one
 * place a course's accent becomes a *background* rather than an icon tint, and
 * those accents are arbitrary hex out of authored course data — a pale course
 * loses a cream glyph, a deep one loses an ink glyph, so neither works as a
 * fixed choice. CSS can't branch on this (color-contrast() isn't shipped), but
 * the color is already passing through here on its way to --node-accent.
 */
function glyphOn(color: string): string {
  const parsed = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!parsed) return "var(--paper)";
  const digits = parsed[1]!;
  const n = parseInt(digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits, 16);
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return luminance > GLYPH_CROSSOVER ? "var(--ink)" : "var(--paper)";
}

/**
 * Reads the effective --wobble-max off a real element — the same custom
 * property .node's transform scales against — so the trail always uses
 * whatever the current breakpoint resolved it to, without a second copy of
 * the 780px number living in JS to drift out of sync with the CSS.
 */
function readWobbleMax(el: HTMLElement): number {
  const raw = getComputedStyle(el).getPropertyValue("--wobble-max").trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : DEFAULT_WOBBLE_MAX;
}

/**
 * Decorative scenery along the path, cycling through the set and tucked on
 * whichever side the node *isn't* wobbling toward so it never fights the node
 * for space.
 */
const SCENERY = [
  { src: pineAsset, kind: "pine" },
  { src: campfireAsset, kind: "campfire" },
  { src: boulderAsset, kind: "boulder" },
  { src: tentAsset, kind: "tent" },
  { src: canoeAsset, kind: "canoe" },
] as const;

const SHOW_SCENERY = true;

/**
 * The two phases of the wave where a node is at full amplitude.
 *
 * At a period of 7 the sine's extremes land on index 2 (+0.975) and index 5
 * (-0.975); 1 and 6 are the near-misses at ±0.782. Taking one crest from each
 * half puts a piece against the widest part of every swing and alternates sides
 * as the wave does.
 *
 * Worth knowing how little of the wave a unit actually covers: `index` is the
 * lesson's position *within its unit*, and the schema caps a unit at 8 lessons
 * with most running 3-6. So a typical unit reaches index 5 at best and phase 5
 * often never fires at all — one piece per unit is the normal case, two the
 * exception. Anything keyed on index alone therefore sees only the first entry
 * or two of the set, which is why the cycle below counts units instead.
 */
const PEAK_PHASES = [2, 5] as const;

function sceneryFor(index: number, unitIndex: number): (typeof SCENERY)[number] | null {
  if (!SHOW_SCENERY) return null;
  const phase = PEAK_PHASES.indexOf((index % WAVE_PERIOD) as (typeof PEAK_PHASES)[number]);
  if (phase < 0) return null;
  // Keyed on the unit, not on a running total: `index` restarts at 0 in every
  // unit, so a position derived from it alone restarts the set in every unit too
  // — which is exactly how the path ended up showing nothing but the first two
  // pieces. Deterministic rather than accumulated, so no unit needs to know how
  // many pieces the units before it happened to place.
  return SCENERY[(unitIndex * PEAK_PHASES.length + phase) % SCENERY.length] ?? null;
}

/** Trims the coordinate noise that would otherwise bloat the `d` attribute. */
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * A smooth dotted trail through node centers, drawn as a Catmull-Rom spline
 * converted to cubic beziers.
 *
 * The obvious technique for a mostly-vertical connector is a vertical-midpoint
 * bezier per pair, but its control points sit directly above and below the two
 * endpoints, which pins the tangent at *every* node to straight-down. The line
 * then leaves each node vertically, swings across, and re-enters the next one
 * vertically — a stack of S-jogs rather than a wave. Catmull-Rom instead takes
 * each node's tangent from the chord between its two neighbors, so the curve
 * carries its sideways momentum through the node and a sine-spaced column of
 * nodes traces an actual sine. Endpoints duplicate their neighbor to get a
 * sane tangent where there is nothing beyond.
 */
function trailPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${round(points[0]!.x)} ${round(points[0]!.y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p0 = points[i - 1] ?? p1;
    const p3 = points[i + 2] ?? p2;
    // The /6 is the standard Catmull-Rom-to-bezier conversion: a control point
    // one sixth of the way along the neighbor-to-neighbor chord reproduces the
    // spline's tangent exactly.
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${round(c1x)} ${round(c1y)}, ${round(c2x)} ${round(c2y)}, ${round(p2.x)} ${round(p2.y)}`;
  }
  return d;
}

interface Props {
  course: CourseTree;
  nodes: LessonNode[];
  currentLessonId: string | null;
  onOpen: (lessonId: string) => void;
}

export function FieldPath({ course, nodes, currentLessonId, onOpen }: Props) {
  // At most one node's panel is open at a time, so this lives here rather than
  // in each PathNode — opening one has to close whichever other was open.
  const [openId, setOpenId] = useState<string | null>(null);

  // Escape, and any pointer landing outside a node or its panel, close it.
  // Nodes are excluded from the outside test because their own handler toggles;
  // letting this fire first would close and immediately reopen.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest(".node, .node-panel")) return;
      setOpenId(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [openId]);

  const nodesByUnit = new Map<string, LessonNode[]>();
  for (const node of nodes) {
    const list = nodesByUnit.get(node.unitId) ?? [];
    list.push(node);
    nodesByUnit.set(node.unitId, list);
  }

  return (
    <div>
      {course.units.map((unit, unitIndex) => (
        <UnitSection
          key={unit.id}
          unit={unit}
          unitIndex={unitIndex}
          color={PATH_ACCENT}
          nodes={nodesByUnit.get(unit.id) ?? []}
          currentLessonId={currentLessonId}
          openId={openId}
          onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
          onOpen={(id) => {
            onOpen(id);
            setOpenId(null);
          }}
        />
      ))}
    </div>
  );
}

function UnitSection({
  unit,
  unitIndex,
  color,
  nodes,
  currentLessonId,
  openId,
  onToggle,
  onOpen,
}: {
  unit: UnitStub;
  unitIndex: number;
  color: string;
  nodes: LessonNode[];
  currentLessonId: string | null;
  openId: string | null;
  onToggle: (lessonId: string) => void;
  onOpen: (lessonId: string) => void;
}) {
  const authored = nodes.filter((n) => n.authored).length;
  const pathRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLElement>(null);
  // Refs on the *rail wrapper*, not the node button itself. The button's
  // transform carries more than the wobble — hover and :active stack a
  // translateY on top of it, under a transition — so its rect is only its
  // resting position some of the time. The rail wrapper never moves, so its
  // box is a stable, transform-free anchor: add the same wobble number used
  // to build the CSS (computed here, not re-measured) to get the node's
  // resting center with nothing left to fall out of sync.
  const railEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const [trail, setTrail] = useState("");
  // Explicit width/height + a matching viewBox, both driven by the same
  // measurement below, so the SVG's own coordinate space always maps 1:1 to
  // the container's own CSS pixels regardless of percentage-sizing quirks.
  const [size, setSize] = useState({ width: 0, height: 0 });

  const measureTrail = () => {
    const container = pathRef.current;
    if (!container) return;
    const containerBox = container.getBoundingClientRect();
    // getBoundingClientRect() answers in *client* pixels, which fold in the
    // page's `zoom` (see --zoom in app.css). Everything else here — the
    // wobble offsets below, and the width/height/viewBox handed to the SVG —
    // lives in the container's own unzoomed CSS pixels, which is exactly what
    // offsetWidth reports. Their ratio is the conversion between the two
    // spaces; deriving it per measurement means it tracks whatever --zoom (or
    // any ancestor scale) currently resolves to instead of hardcoding 1.5
    // here as a fourth copy of that number.
    const scale = container.offsetWidth > 0 ? containerBox.width / container.offsetWidth : 1;
    setSize({ width: containerBox.width / scale, height: containerBox.height / scale });
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const rail = railEls.current.get(i);
      if (!rail) continue;
      const box = rail.getBoundingClientRect();
      // Mirrors the multiplication CSS does on .node's transform, via the same
      // --wobble-max custom property, read straight off the rail so it's
      // always whatever the current breakpoint actually resolved it to — no
      // separate breakpoint number to keep in sync by hand. Custom properties
      // are plain tokens, so this lands in CSS pixels and gets added *after*
      // the measured half of the coordinate is converted.
      const wobble = waveOffset(i) * readWobbleMax(rail);
      points.push({
        x: (box.left + box.width / 2 - containerBox.left) / scale + wobble,
        y: (box.top + box.height / 2 - containerBox.top) / scale,
      });
    }
    setTrail(trailPath(points));
  };

  // Re-measured on mount and on any resize of the column. Opening a node's
  // panel is deliberately *not* one of those: the panel is an overlay, so it
  // changes no rail position and the trail underneath it stays valid.
  useLayoutEffect(() => {
    measureTrail();
    const container = pathRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureTrail());
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  // Fades the sign out as its unit runs out from under it, the same
  // scroll-linked way the course header goes (see CourseScreen). The input
  // differs because the situation does: the header measures the window's own
  // scroll, since it is what travels. A sign doesn't travel — it is stuck to
  // the top of the screen — so what's measured is how much of its section is
  // still below it.
  //
  // Written onto the node rather than held in state, for the same reason: this
  // changes on every frame of a scroll, and a render per frame would re-measure
  // every trail on the page.
  useEffect(() => {
    let frame = 0;
    // Both in client pixels, the space getBoundingClientRect reports in. The
    // sticky offset is authored in local px, so it takes body's zoom on the
    // way in; the scale is read off the sign itself rather than from the
    // --zoom token so there is no second copy of that number to keep honest.
    // Re-measured on resize, where the sign can rewrap and change height.
    let stickyTop = 0;
    let distance = 0;

    const measure = (head: HTMLElement) => {
      const rect = head.getBoundingClientRect();
      const scale = head.offsetHeight > 0 ? rect.height / head.offsetHeight : 1;
      stickyTop = parseFloat(getComputedStyle(head).top) * scale;
      distance = Math.max(1, rect.height);
    };

    const apply = () => {
      frame = 0;
      const head = headRef.current;
      const section = sectionRef.current;
      if (!head || !section) return;
      if (!distance) measure(head);
      // How much room is left between the end of the section and the bottom of
      // the stuck sign. It reaches zero exactly when sticky starts pushing the
      // sign up, so spending the fade on the `distance` before that empties the
      // sign just in time for a shove nobody sees.
      //
      // Measured off the section, which no transform of ours touches — reading
      // the sign's own rect would feed the lift we apply back into the input
      // and let the two chase each other.
      const room = section.getBoundingClientRect().bottom - stickyTop - distance;
      const fade = Math.min(1, Math.max(0, 1 - room / distance));
      head.style.setProperty("--head-fade", `${fade}`);
      head.style.pointerEvents = fade > 0.5 ? "none" : "";
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onResize = () => {
      distance = 0;
      schedule();
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={sectionRef}>
      <header className="unit-head" ref={headRef}>
        <div>
          <div className="eyebrow">
            Unit {String(unitIndex + 1).padStart(2, "0")} · {unit.lessons.length} lesson
            {unit.lessons.length === 1 ? "" : "s"}
            {authored < nodes.length ? ` · ${authored} written` : ""}
          </div>
          <h2>{unit.title}</h2>
        </div>
      </header>

      <div className="path" ref={pathRef}>
        <svg className="path__line" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden="true">
          <path d={trail} />
        </svg>
        {nodes.map((node, index) => (
          <PathNode
            key={node.lessonId}
            node={node}
            index={index}
            unitIndex={unitIndex}
            total={nodes.length}
            color={color}
            isCurrent={node.lessonId === currentLessonId}
            isOpen={node.lessonId === openId}
            onToggle={onToggle}
            onOpen={onOpen}
            registerRail={(el) => {
              if (el) railEls.current.set(index, el);
              else railEls.current.delete(index);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function PathNode({
  node,
  index,
  unitIndex,
  total,
  color,
  isCurrent,
  isOpen,
  onToggle,
  onOpen,
  registerRail,
}: {
  node: LessonNode;
  index: number;
  /** Only used to advance the scenery cycle — see sceneryFor. */
  unitIndex: number;
  total: number;
  color: string;
  isCurrent: boolean;
  isOpen: boolean;
  onToggle: (lessonId: string) => void;
  onOpen: (lessonId: string) => void;
  registerRail: (el: HTMLDivElement | null) => void;
}) {
  const locked = node.state === "locked";
  const wobble = waveOffset(index);
  const scenery = sceneryFor(index, unitIndex);
  const sceneryOnLeft = wobble >= 0;
  // Shared by the button, the callout and the panel. They're siblings, not
  // descendants of one another, so each needs its own copy.
  const themeVars = {
    ["--node-accent" as string]: color,
    ["--node-glyph" as string]: glyphOn(color),
    // Unitless on purpose — CSS multiplies it by --wobble-max.
    ["--wobble" as string]: `${wobble}`,
  };

  return (
    <div className="node-row">
      <div className="node-row__rail" ref={registerRail}>
        {scenery && (
          // Wrapped rather than a bare <img> so the contact shadow can be a
          // pseudo-element on something — an <img> is a replaced element and has
          // no ::before to hang it on.
          <span
            className="node-row__scenery"
            data-scenery={scenery.kind}
            data-side={sceneryOnLeft ? "left" : "right"}
            aria-hidden="true"
          >
            <img src={scenery.src} alt="" />
          </span>
        )}
        {/* Before the button so it paints behind it: both are positioned with
            auto z-index, which stacks them in DOM order. */}
        {isCurrent && !locked && (
          <span
            className="node-row__ring"
            data-kind={node.kind}
            style={themeVars}
            aria-hidden="true"
          />
        )}

        <button
          className="node"
          data-state={node.state}
          data-kind={node.kind}
          data-current={isCurrent || undefined}
          style={themeVars}
          // Locked nodes stay clickable on purpose — the panel is where you
          // find out *why* a lesson is locked, so refusing the click would
          // withhold the one thing the tap was asking for. It's the panel's
          // action button that's disabled, not the node.
          onClick={() => onToggle(node.lessonId)}
          aria-expanded={isOpen}
          aria-label={`${node.title} — ${locked ? "locked" : node.state}`}
        >
          <span className="node__content">
            <NodeGlyph node={node} />
          </span>
        </button>

        {isCurrent && !locked && !isOpen && (
          <div className="node-row__callout-wrap" style={themeVars}>
            <div className="node-row__callout">{node.crowns > 0 ? "Practice" : "Start"}</div>
          </div>
        )}

        {/* Inside the rail, not beside it, so the panel can be positioned off
            the rail's own bottom edge rather than off the row box and its
            padding. It is absolutely positioned either way, so it adds no
            height here and the nodes below never move. */}
        {isOpen && (
          <NodePanel
            node={node}
            index={index}
            total={total}
            themeVars={themeVars}
            onStart={() => onOpen(node.lessonId)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The lesson card, opened by tapping a node and anchored under it by a tail
 * that tracks the same wobble the node does. It carries what used to sit in a
 * permanent label beside every node: with one card open at a time the path
 * itself stays a clean column of gumdrops, and the detail appears only for the
 * lesson actually being considered.
 */
function NodePanel({
  node,
  index,
  total,
  themeVars,
  onStart,
}: {
  node: LessonNode;
  index: number;
  total: number;
  themeVars: Record<string, string>;
  onStart: () => void;
}) {
  const locked = node.state === "locked";
  const exercises = `${node.exerciseCount} exercise${node.exerciseCount === 1 ? "" : "s"}`;

  const meta = locked
    ? node.authored
      ? "Complete the lessons above to unlock this"
      : "Still being written"
    : node.kind === "checkpoint"
      ? `Checkpoint · ${exercises}`
      : `Lesson ${index + 1} of ${total} · ${exercises}`;

  return (
    <div className="node-panel" data-locked={locked || undefined} style={themeVars}>
      <h3 className="node-panel__title">{node.title}</h3>
      <p className="node-panel__meta">{meta}</p>
      <button className="btn btn--lg node-panel__action" disabled={locked} onClick={onStart}>
        {locked ? "Locked" : node.crowns > 0 ? "Practice again" : "Start"}
      </button>
    </div>
  );
}

function NodeGlyph({ node }: { node: LessonNode }) {
  if (node.state === "locked") return <IconLock size={20} />;
  if (node.state === "mastered") return <IconStar size={22} />;
  if (node.state === "complete") return <IconCheck size={22} />;
  if (node.kind === "checkpoint") return <IconStar size={22} />;
  if (node.kind === "practice") return <IconDumbbell size={19} />;
  return <IconBook size={20} />;
}

