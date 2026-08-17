import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short, URL-safe, collision-resistant-enough id for local content. */
export function shortId(size = 10): string {
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

export function prefixedId(prefix: string, size = 8): string {
  return `${prefix}_${shortId(size)}`;
}

/** Turn a human title into a filesystem- and URL-safe slug. */
export function slugify(input: string, maxLength = 48): string {
  const base = input
    .normalize("NFKD")
    // strip combining diacritical marks left behind by NFKD

    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return base || `course-${shortId(6)}`;
}
