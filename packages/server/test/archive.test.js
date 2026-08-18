import test from "node:test";
import assert from "node:assert/strict";
import { extractText, locateQuote } from "@metaharness/core";

const PAGE = `<!doctype html>
<html><head><title>Ignored</title><style>.x{color:red}</style></head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <article>
    <h1>Attention &amp; Transformers</h1>
    <p>The Transformer is based solely on attention mechanisms, dispensing with
       recurrence and convolutions entirely.</p>
    <p>In the decoder, self-attention is masked so that a position cannot attend
       to subsequent positions &mdash; this preserves the autoregressive property.</p>
  </article>
  <script>console.log("tracking pixel")</script>
  <footer>&copy; 2017</footer>
</body></html>`;

test("extractText keeps prose and drops markup, scripts and styles", () => {
  const text = extractText(PAGE);
  assert.match(text, /Attention & Transformers/, "entities should be decoded");
  assert.match(text, /dispensing with recurrence and convolutions entirely/);
  assert.doesNotMatch(text, /tracking pixel/, "script contents must not survive");
  assert.doesNotMatch(text, /color:red/, "style contents must not survive");
  assert.doesNotMatch(text, /<[a-z]/i, "no tags should remain");
  // Paragraphs stay separated so the viewer can render readable blocks, but a
  // line break *inside* a paragraph in the HTML source is collapsed the way a
  // browser collapses it.
  assert.match(text, /entirely\.\n+In the decoder/);
  assert.match(text, /dispensing with recurrence/, "source line wrapping must not survive inside a paragraph");
});

test("an exact quote is located as verbatim, with usable offsets", () => {
  const text = extractText(PAGE);
  const hit = locateQuote(text, "dispensing with recurrence and convolutions entirely");
  assert.ok(hit, "quote should be found");
  assert.equal(hit.kind, "verbatim");
  assert.equal(hit.score, 1);
  assert.equal(
    text.slice(hit.start, hit.end),
    "dispensing with recurrence and convolutions entirely",
    "offsets must select exactly the quoted span, for the highlight",
  );
});

test("copying artefacts do not demote a verbatim quote to a paraphrase", () => {
  const text = extractText(PAGE);
  // Smart quotes, collapsed line wrapping and different case are all things that
  // happen when text is lifted out of a page — none of them is paraphrasing.
  const hit = locateQuote(text, "Self-Attention   is masked so that a position cannot attend\n to subsequent positions");
  assert.ok(hit, "quote should still be found");
  assert.equal(hit.kind, "verbatim");
});

test("a reworded claim is found, and reported as a paraphrase rather than verbatim", () => {
  const text = extractText(PAGE);
  const hit = locateQuote(text, "the decoder masks self-attention so a position cannot see later positions, keeping it autoregressive");
  assert.ok(hit, "a paraphrase reusing the terms of art should be locatable");
  assert.equal(hit.kind, "paraphrase");
  assert.ok(hit.score < 1, "a paraphrase must never score as an exact match");
});

test("a claim that is not in the document is rejected, not attributed", () => {
  const text = extractText(PAGE);
  // This is the real failure this whole mechanism exists to stop: the generated
  // LLM course asserts exactly this, and it is wrong. Asked after the fact, a
  // model would happily cite this very paper for it.
  const fabricated = locateQuote(
    text,
    "self-attention looks at all tokens simultaneously including future ones, so attention is bidirectional",
  );
  assert.equal(fabricated, null, "a fabricated citation must be rejected outright");
});

test("a quote too short to be evidence of anything is rejected", () => {
  const text = extractText(PAGE);
  assert.equal(locateQuote(text, "attention"), null, "a single common word is not a citation");
});
