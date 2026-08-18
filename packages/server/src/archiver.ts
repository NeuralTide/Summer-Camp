import { extractText, prefixedId, type ArchivedSource, type Source } from "@metaharness/core";

/**
 * Fetching and keeping the pages a course was written from.
 *
 * This runs on the server and never through the agent, which is the point: the
 * archive has to be the thing that *checks* the model, so it cannot be
 * something the model produced. What lands here is whatever the URL actually
 * served.
 */

/** Enough for a long article; past this a page is a dump, not a source. */
const MAX_BYTES = 4_000_000;
/** Markup we are willing to keep per source. Most articles are well under this. */
const MAX_HTML_BYTES = 1_500_000;
const TIMEOUT_MS = 20_000;

/**
 * A browser-ish User-Agent, because a good number of publishers serve a block
 * page to anything that looks automated and a block page extracts into
 * plausible-looking text. Failing loudly is better than archiving the refusal.
 */
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function fetchArchive(source: Source): Promise<ArchivedSource> {
  const base = {
    id: prefixedId("src"),
    url: source.url ?? "",
    title: source.title,
    fetchedAt: new Date().toISOString(),
  };
  const fail = (failure: string): ArchivedSource => ({ ...base, text: "", ok: false, failure });

  if (!source.url) return fail("This source has no link to fetch.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.8" },
    });
    if (!res.ok) return fail(`The site answered ${res.status}.`);

    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
      // PDFs are the common case here and are worth archiving eventually, but
      // extracting one is a different job than stripping tags; saying so beats
      // storing the raw bytes as if they were readable.
      return fail(`Not a readable page (${type.split(";")[0] || "unknown type"}).`);
    }

    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return fail("The page is too large to archive.");

    const raw = new TextDecoder("utf-8").decode(body);
    const plain = /text\/plain/i.test(type);
    const text = plain ? raw.replace(/\s+/g, " ").trim() : extractText(raw);
    if (text.length < 200) return fail("The page had almost no readable text — it may need JavaScript to render.");

    // The markup is kept so the viewer can show the document rather than a
    // transcript of it. Capped separately from the fetch limit: a page far past
    // this is a dump, and storing it would dwarf the course it belongs to.
    const html = plain || raw.length > MAX_HTML_BYTES ? undefined : raw;
    return { ...base, text, ...(html ? { html } : {}), ok: true };
  } catch (err) {
    const reason = (err as Error).name === "AbortError" ? "The site took too long to answer." : (err as Error).message;
    return fail(reason);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Archive every source a course has that is not archived yet.
 *
 * Sequential on purpose. This is a background nicety running against a dozen
 * unrelated publishers, and hammering them in parallel to save a few seconds is
 * how a tool earns a block.
 */
export async function archiveMissing(
  sources: Source[],
  have: ArchivedSource[],
  onProgress?: (done: number, total: number) => void,
): Promise<ArchivedSource[]> {
  const known = new Set(have.filter((a) => a.ok).map((a) => a.url));
  const todo = sources.filter((s) => s.url && !known.has(s.url));
  const out: ArchivedSource[] = [];
  for (const [i, source] of todo.entries()) {
    out.push(await fetchArchive(source));
    onProgress?.(i + 1, todo.length);
  }
  return out;
}
