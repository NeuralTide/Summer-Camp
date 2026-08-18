import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { IconCross, IconInfo } from "./Icons";
import type { ArchivedSource, BlockProvenance } from "../lib/types";

/**
 * Lesson prose you can check.
 *
 * The reading page looks exactly as it did — no highlighter pen, no footnote
 * markers, no coloured text. A paragraph the course can account for outlines
 * when the pointer is over it, and clicking it opens the page it came from with
 * the matching passage highlighted.
 *
 * A paragraph with nothing behind it stays inert, and that is the feature: the
 * absence of an outline is the app declining to vouch for a sentence, which is
 * only meaningful because the presence of one is never guessed. Matching is
 * plain string search against archived source text (see `locateProse` in core)
 * — the model is never asked where it got something, because a model asked
 * after the fact will produce a confident answer either way.
 */

/**
 * Mirror of `provenanceKey` in @metaharness/core. Duplicated rather than
 * imported because the UI bundle deliberately does not depend on the Node
 * packages; the two must agree, and the shared test in the server suite is what
 * holds them together.
 */
function provenanceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

interface Props {
  courseId: string;
  lessonId: string | null;
  html: string;
}

export function SourcedNotes({ courseId, lessonId, html }: Props) {
  const [blocks, setBlocks] = useState<BlockProvenance[]>([]);
  const [proseCount, setProseCount] = useState(0);
  const [verified, setVerified] = useState(false);
  const [open, setOpen] = useState<BlockProvenance | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  /*
   * One entry per paragraph, keeping its best-supported citation. A paragraph
   * may cite several claims, and the outline can only say one thing — so it
   * says the strongest, and the panel opens that one. (The server already sorts
   * strongest-first; this relies on Map.set not overwriting, so it re-checks
   * rather than trusting the order to survive a future change.)
   */
  const byKey = useMemo(() => {
    const best = new Map<string, BlockProvenance>();
    for (const block of blocks) {
      const seen = best.get(block.key);
      if (!seen || block.score > seen.score) best.set(block.key, block);
    }
    return best;
  }, [blocks]);
  /** Paragraphs with a source, not citations — a block may rest on several claims. */
  const cited = byKey.size;

  useEffect(() => {
    if (!lessonId) return;
    let live = true;
    api
      .provenance(courseId, lessonId)
      .then((res) => {
        if (!live) return;
        setBlocks(res.blocks);
        setProseCount(res.proseCount);
        setVerified(res.verified);
      })
      // No sources, nothing archived, older course — the notes simply read as
      // notes. Provenance is an addition to the page, never a precondition.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [courseId, lessonId]);

  // Mark up the rendered markdown after it lands. Layout effect so the outline
  // is attached before the first paint the reader sees, not a frame later.
  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>("p, li, blockquote")) {
      const hit = byKey.get(provenanceKey(el.textContent ?? ""));
      if (hit) {
        el.dataset.sourced = hit.support;
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.setAttribute("aria-label", `Check this against ${hit.sourceTitle}`);
      } else {
        delete el.dataset.sourced;
        el.removeAttribute("role");
        el.removeAttribute("tabindex");
        el.removeAttribute("aria-label");
      }
    }
  }, [byKey, html]);

  const hitFor = (target: EventTarget | null): BlockProvenance | null => {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-sourced]");
    if (!el) return null;
    return byKey.get(provenanceKey(el.textContent ?? "")) ?? null;
  };

  return (
    <>
      <div
        ref={bodyRef}
        className="article__body"
        onClick={(e) => {
          const hit = hitFor(e.target);
          if (hit) setOpen(hit);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          const hit = hitFor(e.target);
          if (!hit) return;
          e.preventDefault();
          setOpen(hit);
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {blocks.length > 0 && (
        <p className="sourced__summary">
          <IconInfo size={13} />
          {/*
            Counted from distinct paragraphs, never from `blocks.length`: one
            paragraph resting on two claims is two entries and one paragraph,
            and a coverage line that double-counts is the exact failure this
            feature exists to prevent. "Every" is likewise asserted only when it
            is actually true — a lesson from before citations, or one edited by
            hand, can be partly covered even when what it does have is verified.
          */}
          {cited === proseCount
            ? `Every paragraph is cited — hover one to open its source.`
            : `${cited} of ${proseCount} paragraph${proseCount === 1 ? "" : "s"} ${
                verified ? "cited by the author" : "matched to a source after the fact"
              } — hover one to check it.`}
        </p>
      )}

      {open && <SourceViewer courseId={courseId} hit={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/**
 * The archived page, with the cited passage highlighted and scrolled to.
 *
 * Reading our own copy rather than framing the live site is not a shortcut: the
 * page may have changed or gone, most sites refuse to be framed at all, and
 * highlighting a span inside someone else's document is not something a frame
 * permits. The archive is also what the claim was actually checked against, so
 * it is the honest thing to show.
 */
function SourceViewer({ courseId, hit, onClose }: { courseId: string; hit: BlockProvenance; onClose: () => void }) {
  const [fallback, setFallback] = useState<ArchivedSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /*
   * Shifting the lesson is the panel's business, but the lesson is not in this
   * subtree — the panel is portaled to <body> and the player is mounted
   * elsewhere. A class on <body> is what lets one move the other without
   * threading a prop through the whole player.
   *
   * Removed on unmount, so the lesson slides back whichever way the panel
   * closed: the button, Escape, or leaving the reading page entirely.
   */
  useEffect(() => {
    document.body.classList.add("viewer-open");
    return () => document.body.classList.remove("viewer-open");
  }, []);

  // Only fetched when there is no archived markup to render — an older archive,
  // or a source that came back as plain text.
  useEffect(() => {
    if (hit.hasDocument) return;
    let live = true;
    api
      .archivedSource(courseId, hit.sourceId)
      .then((res) => live && setFallback(res))
      .catch(() => live && setError("That source is no longer archived."));
    return () => {
      live = false;
    };
  }, [courseId, hit.sourceId, hit.hasDocument]);

  /*
   * Rendered into <body>. The lesson player is a transformed, scrolling
   * container, and a transform makes an ancestor the containing block for
   * `position: fixed` descendants — so the panel would be positioned and
   * scrolled inside the article rather than pinned to the window.
   *
   * No backdrop and no click-to-close: the lesson beside it stays live, so a
   * stray click on the text must not dismiss the thing you are reading it
   * against. The close button and Escape do that.
   */
  return createPortal(
    <div className="viewer" role="dialog" aria-label="Source">
      <div className="viewer__bar">
        <div className="viewer__id">
          <span className={`viewer__badge viewer__badge--${hit.support}`}>{badgeText(hit)}</span>
          <strong>{hit.sourceTitle}</strong>
          {hit.sourceUrl && (
            <a className="viewer__url" href={hit.sourceUrl} target="_blank" rel="noreferrer noopener">
              {hit.sourceUrl}
            </a>
          )}
        </div>
        <button className="viewer__close" onClick={onClose} aria-label="Close">
          <IconCross size={16} />
        </button>
      </div>

      {hit.hasDocument ? (
        /*
         * The archived page as a page. Sandboxed with nothing granted: no
         * scripts, no same-origin, no forms — the document is third-party
         * markup and the highlight is already baked into it server-side, so
         * the frame needs no capabilities at all to do its job.
         */
        <iframe
          className="viewer__frame"
          src={api.documentUrl(courseId, hit)}
          sandbox=""
          referrerPolicy="no-referrer"
          title={`Archived copy of ${hit.sourceTitle}`}
        />
      ) : (
        <div className="viewer__page">
          {error && <p className="faint">{error}</p>}
          {!fallback && !error && <p className="faint">Opening the archived page…</p>}
          {fallback && <PlainArchive text={fallback.text} start={hit.start} end={hit.end} />}
        </div>
      )}

      <div className="viewer__foot faint">{footerText(hit)}</div>
    </div>,
    document.body,
  );
}

/** Fallback rendering for archives kept without their markup. */
function PlainArchive({ text, start, end }: { text: string; start?: number; end?: number }) {
  const markRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, []);
  if (start === undefined || end === undefined) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark ref={markRef}>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/*
 * Two different things get called "cited", and conflating them is what this
 * whole feature exists to avoid:
 *
 *   1. the quote below was found, word for word, in the archived page — checked
 *      by the server, which refused the claim outright otherwise;
 *   2. this paragraph is the one the author said rests on that quote — asserted
 *      by the author, and graded only by how much wording the two share.
 *
 * The badge reports the second, because the first is true of everything that
 * gets this far and so distinguishes nothing. A paragraph that merely points at
 * a quote must not wear the same label as one that repeats it.
 */
function badgeText(hit: BlockProvenance): string {
  if (!hit.verified) return `Possible match · ${Math.round(hit.score * 100)}%`;
  switch (hit.support) {
    case "quoted":
      return "Quotes the source";
    case "restated":
      return `Restates the source · ${Math.round(hit.score * 100)}% of its wording`;
    default:
      return "Cited, not quoted";
  }
}

function footerText(hit: BlockProvenance): string {
  if (!hit.verified) {
    return "Matched by comparing the lesson against this page. Nobody declared this citation — treat it as a lead, not a source.";
  }
  const checked = "The highlighted quote was found in this page before the lesson was saved.";
  switch (hit.support) {
    case "quoted":
      return `${checked} This paragraph repeats it almost word for word.`;
    case "restated":
      return `${checked} This paragraph puts it in other words, and most of its wording traces back here.`;
    default:
      // The honest reading of a low score, without calling it wrong: the author
      // linked the two, and the wording does not overlap enough to confirm it.
      return `${checked} The author linked this paragraph to it, but the two share little wording — read both and judge for yourself.`;
  }
}
