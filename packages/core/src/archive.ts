/**
 * Source archiving: keeping the material a course was written from, so a claim
 * can be opened and checked rather than merely linked.
 *
 * A citation you cannot open is a citation you cannot check, and a model asked
 * after the fact where a sentence came from will invent an answer that looks
 * right. So the flow is inverted: the source text is captured up front, and a
 * citation is only accepted if its quote can actually be found in it. Locating
 * is done here, mechanically — never by asking the model where it got something.
 *
 * Archiving rather than linking also buys three things a link cannot: it works
 * offline, it survives the page changing or disappearing underneath the course,
 * and it renders in our own viewer instead of fighting another site's CORS
 * policy. Extracted text runs about 12% of the page it came from, so a course's
 * whole corpus is smaller than the course file itself.
 */

/** One archived document. `ok: false` records a source we could not capture. */
export interface ArchivedSource {
  id: string;
  url: string;
  title: string;
  fetchedAt: string;
  /** Readable text, whitespace-normalised. Empty when `ok` is false. */
  text: string;
  ok: boolean;
  /** Learner-facing reason the archive is missing, e.g. a site that blocks bots. */
  failure?: string;
}

export type CitationKind = "verbatim" | "paraphrase";

export interface QuoteLocation {
  /** Character offsets into ArchivedSource.text, for the viewer's highlight. */
  start: number;
  end: number;
  kind: CitationKind;
  /** 1 for an exact hit; the token-overlap fraction for a fuzzy one. */
  score: number;
}

/** Blocks whose contents are never prose. */
const DROP_ELEMENTS = /<(script|style|noscript|svg|head|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi;
/** Elements that imply a line break once their tags are gone. */
const BLOCK_ELEMENTS = /<\/?(p|div|section|article|h[1-6]|li|tr|br|blockquote|pre)\b[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Readable text from an HTML page.
 *
 * Deliberately a stripper rather than a readability heuristic. Something like
 * Readability guesses at the "main" element and is wrong often enough to drop
 * the paragraph a lesson happens to cite — and a citation that cannot be located
 * is rejected, so a false negative here costs a real source. Keeping the
 * navigation chrome is untidy in the viewer and harmless to the search.
 */
export function extractText(html: string): string {
  let text = html.replace(DROP_ELEMENTS, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  // Flatten the source's own line breaks *before* block elements introduce any.
  // A newline inside a <p> is formatting in the HTML file, not a line break in
  // the document — every browser collapses it, and keeping it would split a
  // quoted span across a newline so its offsets no longer select the quote.
  text = text.replace(/\s+/g, " ");
  text = text.replace(BLOCK_ELEMENTS, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  text = decodeEntities(text);
  // Tidy, without eating the paragraph breaks just inserted.
  text = text.replace(/[^\S\n]+/g, " ");
  text = text.replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/** Comparison form: case, curly quotes and whitespace flattened. */
function canonical(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "is", "are", "and", "or", "that", "this",
  "it", "as", "by", "for", "with", "on", "at", "be", "can", "will", "its",
  "from", "when", "which", "you", "we", "they",
]);

function significantTokens(input: string): string[] {
  return canonical(input)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Where a quoted passage sits in an archived document, or null if it is not
 * there at all.
 *
 * A null is the whole point: it is what lets a citation be *rejected at write
 * time* rather than shown to a reader as questionable. The model supplies the
 * quote; this decides whether it exists.
 *
 * Exact matching runs against a canonicalised copy, so a quote that differs
 * only in smart quotes or line wrapping still counts as verbatim — those are
 * artefacts of copying text out of a page, not paraphrase. Offsets are mapped
 * back to the original string so the viewer highlights the real span.
 */
export function locateQuote(text: string, quote: string, opts: { minScore?: number } = {}): QuoteLocation | null {
  const minScore = opts.minScore ?? 0.6;
  const needle = canonical(quote);
  if (needle.length < 12) return null;

  // Canonical copy plus an index back to original offsets, so an exact hit can
  // be reported against the text the viewer actually renders.
  let flat = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      pendingSpace = flat.length > 0;
      continue;
    }
    if (pendingSpace) {
      flat += " ";
      map.push(i);
      pendingSpace = false;
    }
    flat += ch.toLowerCase().replace(/[’‘]/, "'").replace(/[“”]/, '"');
    map.push(i);
  }

  const exact = flat.indexOf(needle);
  if (exact >= 0) {
    return {
      start: map[exact] ?? 0,
      end: (map[exact + needle.length - 1] ?? text.length - 1) + 1,
      kind: "verbatim",
      score: 1,
    };
  }

  // No exact hit: find the window with the most overlap with the quote's
  // significant words. A paraphrase still reuses the terms of art it is
  // paraphrasing, which is what makes this findable at all.
  const wanted = new Set(significantTokens(quote));
  if (wanted.size === 0) return null;

  const words: Array<{ word: string; start: number; end: number }> = [];
  const re = /[A-Za-z0-9]+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    words.push({ word: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
  }
  if (words.length === 0) return null;

  const window = Math.max(wanted.size * 3, 24);
  let best: QuoteLocation | null = null;
  const counts = new Map<string, number>();
  let hits = 0;

  const add = (w: string) => {
    if (!wanted.has(w)) return;
    const n = (counts.get(w) ?? 0) + 1;
    counts.set(w, n);
    if (n === 1) hits++;
  };
  const drop = (w: string) => {
    if (!wanted.has(w)) return;
    const n = (counts.get(w) ?? 0) - 1;
    counts.set(w, n);
    if (n === 0) hits--;
  };

  for (let end = 0; end < words.length; end++) {
    add(words[end]!.word);
    if (end >= window) drop(words[end - window]!.word);
    const score = hits / wanted.size;
    if (score >= minScore && (!best || score > best.score)) {
      const startWord = words[Math.max(0, end - window + 1)]!;
      best = { start: startWord.start, end: words[end]!.end, kind: "paraphrase", score: Math.round(score * 100) / 100 };
    }
  }

  return best;
}
