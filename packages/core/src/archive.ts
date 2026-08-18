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
  /**
   * The page's own HTML, kept so the viewer can show the document rather than a
   * transcript of it. Scripts are stripped at fetch time; assets still load from
   * the publisher via a <base> tag, so this is the markup only.
   */
  html?: string;
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

/* ------------------------------------------------------------------ */
/* Locating a lesson's prose in the material it was written from       */
/* ------------------------------------------------------------------ */

export interface BlockProvenance {
  /** Normalised block text — how the viewer looks a block up. */
  key: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl: string;
  start: number;
  end: number;
  kind: CitationKind;
  score: number;
}

/**
 * The lookup key for a block of lesson prose.
 *
 * The server splits markdown; the browser walks rendered DOM. Those two never
 * agree on markup, so neither can hand the other an index and be trusted — the
 * first `*emphasis*` or footnote shifts everything after it. They do agree on
 * the words, so the words are the key.
 */
export function provenanceKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Split a paragraph-sized chunk further at headings and list markers.
 *
 * Blank lines alone are the wrong unit. A markdown list is one chunk by that
 * measure but renders as one element per item, so keying the whole list
 * produces a key no element in the document will ever carry — the block matches
 * a source, and then silently fails to mark anything. Continuation lines stay
 * with the item they belong to.
 */
function segments(chunk: string): string[] {
  const out: string[][] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length) out.push(current);
    current = [];
  };
  for (const line of chunk.split("\n")) {
    const heading = /^\s*#{1,6}\s/.test(line);
    // A heading closes on its own line; a list item stays open for the lines
    // that continue it.
    if (heading || /^\s*([-*+]|\d+\.)\s/.test(line)) flush();
    current.push(line);
    if (heading) flush();
  }
  flush();
  return out.map((lines) => lines.join("\n"));
}

/** Prose blocks of a markdown document, with the syntax taken back off. */
export function proseBlocks(markdown: string): string[] {
  // Fenced code is not prose and must not be matched against a source.
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "\n\n");
  return withoutCode
    .split(/\n\s*\n/)
    .flatMap(segments)
    .map((block) =>
      block
        .replace(/^\s*[#>\-*+]+\s*/gm, "")
        .replace(/^\s*\d+\.\s*/gm, "")
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`~]/g, "")
        // Display math before inline, or `$$…$$` is eaten as two empty inline
        // spans and its body survives as prose. A rendered equation is KaTeX
        // markup in the document and matches no source text, so a block of it
        // that slipped through would be counted as traceable and then mark
        // nothing — inflating the "n of m sourced" line with a claim the reader
        // cannot check.
        .replace(/\$\$[\s\S]*?\$\$/g, " ")
        .replace(/\$[^$]*\$/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((block) => block.length > 0);
}

/**
 * Where each block of a lesson's notes can be found in the course's sources.
 *
 * Run when the lesson is opened rather than when it is written, which is what
 * makes it retroactive: a course generated before any of this existed gets
 * provenance the moment its sources are archived, with no re-authoring and no
 * model involved. The trade is that a block the author genuinely wrote
 * themselves finds nothing and is simply not marked — which is the honest
 * outcome, and the reason nothing here ever asks a model where a sentence came
 * from.
 *
 * Blocks are attributed to their best-scoring source, so a claim that appears
 * in three of them lands on the one that matches most closely rather than
 * whichever was fetched first.
 */
export function locateProse(markdown: string, archives: ArchivedSource[]): BlockProvenance[] {
  const usable = archives.filter((a) => a.ok && a.text.length > 0);
  if (usable.length === 0) return [];

  const out: BlockProvenance[] = [];
  for (const block of proseBlocks(markdown)) {
    if (block.length < 40) continue; // A sentence fragment matches everything.

    let best: BlockProvenance | null = null;
    for (const source of usable) {
      const hit = locateQuote(source.text, block);
      if (!hit) continue;
      if (!best || hit.score > best.score) {
        best = {
          key: provenanceKey(block),
          sourceId: source.id,
          sourceTitle: source.title,
          sourceUrl: source.url,
          start: hit.start,
          end: hit.end,
          kind: hit.kind,
          score: hit.score,
        };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Showing the archived document itself                                */
/* ------------------------------------------------------------------ */

/** A stretch of text in the HTML — i.e. everything that is not markup. */
function textRuns(html: string): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") {
      const next = html.indexOf("<", i);
      const end = next === -1 ? html.length : next;
      if (end > i) runs.push({ start: i, end });
      i = end;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      const close = html.indexOf("-->", i);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const name = /^<\s*\/?\s*([a-zA-Z][\w-]*)/.exec(html.slice(i, i + 40))?.[1]?.toLowerCase();
    const close = html.indexOf(">", i);
    const tagEnd = close === -1 ? html.length : close + 1;
    // Script and style bodies are text to the parser but not to the reader, and
    // a quote must never be "found" inside one.
    if (name === "script" || name === "style") {
      const m = new RegExp(`</\\s*${name}\\b[^>]*>`, "i").exec(html.slice(tagEnd));
      i = m ? tagEnd + m.index + m[0].length : html.length;
      continue;
    }
    i = tagEnd;
  }
  return runs;
}

/**
 * Wrap a quoted passage in `<mark>` inside the page's own HTML.
 *
 * Offsets into the extracted text cannot be reused here — extraction throws
 * away the markup those offsets would have to index. So the quote is located
 * again against the document's text nodes, and the span is wrapped run by run:
 * a quote that crosses a `<strong>` or a paragraph break becomes several marks
 * rather than one, because a single pair spanning the tags would not nest.
 *
 * Returns null when the quote is not in the document, which the caller should
 * treat as "show the page unhighlighted" rather than an error — the page may
 * simply have changed since it was archived.
 */
export function injectQuoteMark(html: string, quote: string): string | null {
  const needle = canonical(quote);
  if (needle.length < 12) return null;

  const runs = textRuns(html);
  let flat = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace = false;

  const emit = (ch: string, from: number, to: number) => {
    if (pendingSpace) {
      flat += " ";
      starts.push(from);
      ends.push(from);
      pendingSpace = false;
    }
    flat += ch;
    starts.push(from);
    ends.push(to);
  };

  for (const run of runs) {
    let i = run.start;
    while (i < run.end) {
      const ch = html[i]!;
      if (ch === "&") {
        // An entity is one character to the reader and several in the file, so
        // it is emitted decoded while its offsets keep the whole span.
        const m = /^&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/.exec(html.slice(i, i + 12));
        if (m) {
          const decoded = decodeEntities(m[0]);
          if (/\s/.test(decoded)) pendingSpace = flat.length > 0;
          else emit(canonical(decoded) || decoded.toLowerCase(), i, i + m[0].length);
          i += m[0].length;
          continue;
        }
      }
      if (/\s/.test(ch)) {
        pendingSpace = flat.length > 0;
      } else {
        emit(ch.toLowerCase().replace(/[’‘]/, "'").replace(/[“”]/, '"'), i, i + 1);
      }
      i++;
    }
    // A tag boundary separates words even with no whitespace around it.
    pendingSpace = flat.length > 0;
  }

  const at = flat.indexOf(needle);
  if (at < 0) return null;
  const from = starts[at]!;
  const to = ends[at + needle.length - 1]!;

  const out: string[] = [];
  let cursor = 0;
  let first = true;
  for (const run of runs) {
    const s = Math.max(run.start, from);
    const e = Math.min(run.end, to);
    if (s >= e) continue;
    out.push(html.slice(cursor, s), `<mark${first ? ' id="mh-cited"' : ""} class="mh-cited">`, html.slice(s, e), "</mark>");
    cursor = e;
    first = false;
  }
  if (first) return null;
  out.push(html.slice(cursor));
  return out.join("");
}

/**
 * The archived page made safe and self-locating: scripts gone, assets pointed
 * back at the origin, and the cited passage marked.
 *
 * Scripts are stripped even though the viewer sandboxes the frame as well.
 * The sandbox is the guarantee; this is so that a page which would have
 * rewritten itself on load still shows the reader the document the quote was
 * checked against.
 */
export function prepareDocument(archive: ArchivedSource, quote?: string): { html: string; highlighted: boolean } {
  let html = archive.html ?? "";
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<script\b[^>]*\/?>/gi, "");
  // Inline handlers and javascript: targets, which survive script removal.
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "").replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  html = html.replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
  // The page's own <base> would send every relative asset somewhere we did not choose.
  html = html.replace(/<base\b[^>]*>/gi, "");

  const marked = quote ? injectQuoteMark(html, quote) : null;
  if (marked) html = marked;

  const head =
    `<base href="${escapeAttr(archive.url)}">` +
    `<style>mark.mh-cited{background:#ffe066;color:inherit;box-shadow:0 0 0 3px #ffe066;scroll-margin:40vh}</style>`;

  html = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => m + head)
    : `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;

  return { html, highlighted: Boolean(marked) };
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/* ------------------------------------------------------------------ */
/* Grading the second link: does the lesson's wording follow the claim */
/* ------------------------------------------------------------------ */

/**
 * How closely a block of lesson prose follows the claim it cites.
 *
 *  - `quoted`    the block's words appear in the cited material, near enough
 *                word for word.
 *  - `restated`  the block says the claim in its own words, but the terms of
 *                art still line up.
 *  - `asserted`  the author linked the two and nothing in the wording connects
 *                them. This is not necessarily wrong — a lesson that synthesises
 *                two claims into a new sentence lands here honestly — but it is
 *                a weaker thing than a quote, and must not be shown as one.
 */
export type SupportLevel = "quoted" | "restated" | "asserted";

export interface CitationSupport {
  level: SupportLevel;
  /** Fraction of the block's significant words that appear in the claim. */
  score: number;
}

/** Below this a block shares too little wording to call it a restatement. */
const RESTATED_FLOOR = 0.5;

/**
 * Grade the link between a lesson block and the claim it cites.
 *
 * There are two links in this chain and they are not equally solid. The claim's
 * quote is *verified* against the archived page — the server found those exact
 * words in that document, and refused the claim otherwise. But which claim backs
 * which paragraph is the model's assertion, checked by nobody. Left ungraded,
 * both were being shown to the reader as one flat "cited", which quietly
 * overstates the weaker half of the chain.
 *
 * So this measures the second link the only way it can be measured mechanically:
 * how much of the paragraph's own vocabulary is present in the material it
 * points at. Deliberately asymmetric — the question is whether everything the
 * paragraph says is accounted for by the claim, not whether the paragraph
 * repeated all of it, so the block is searched *for* inside the claim rather
 * than the other way round. A paragraph that adds an unsupported sentence
 * therefore scores lower, which is the behaviour we want.
 *
 * A low score is a weak signal, never a verdict: the words can diverge while the
 * meaning holds, and only a reader can judge that. It is reported, not enforced.
 */
export function gradeSupport(blockText: string, claim: { text: string; quote: string }): CitationSupport {
  const block = blockText.trim();
  if (block.length < 12) return { level: "asserted", score: 0 };

  // The claim's own words plus the passage it rests on: either is a legitimate
  // thing for the lesson to be following.
  const cited = `${claim.quote}\n${claim.text}`;
  if (isWordRun(block, cited)) return { level: "quoted", score: 1 };

  const hit = locateQuote(cited, block, { minScore: 0 });
  if (!hit) return { level: "asserted", score: 0 };
  return { level: hit.score >= RESTATED_FLOOR ? "restated" : "asserted", score: hit.score };
}

/**
 * Do `needle`'s words appear in `haystack`, in order and with nothing between?
 *
 * Used instead of `locateQuote`'s verbatim test, which compares punctuation and
 * so is the wrong instrument here. That strictness is right where it lives: it
 * guards whether a *citation is valid* against the archived page, and a quote
 * that drifts is a quote to reject. This is a different question — how closely
 * an author's own paragraph follows the claim — and there, ending a lifted
 * sentence with a full stop where the source had a comma is not paraphrase.
 * Grading it as one understates a paragraph that is, word for word, the source.
 */
function isWordRun(needle: string, haystack: string): boolean {
  const words = (input: string) => canonical(input).match(/[a-z0-9]+/g) ?? [];
  const small = words(needle);
  const big = words(haystack);
  if (small.length < 4 || small.length > big.length) return false;
  for (let i = 0; i + small.length <= big.length; i++) {
    let j = 0;
    while (j < small.length && big[i + j] === small[j]) j++;
    if (j === small.length) return true;
  }
  return false;
}
