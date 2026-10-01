import { bnToEn } from "./numerals";

/**
 * Canonical form for searching/indexing text: NFC → lowercase → Bangla digits to ASCII
 * → strip zero-width joiners (they differ between keyboards) → collapse whitespace.
 */
export function normalizeSearch(input: string): string {
  return bnToEn(input.normalize("NFC"))
    .toLowerCase()
    .replace(/[‌‍]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Unique normalized words, used for the Dexie multi-entry `*searchWords` index. */
export function searchWords(
  ...fields: Array<string | undefined | null>
): string[] {
  const words = new Set<string>();
  for (const field of fields) {
    if (!field) continue;
    for (const word of normalizeSearch(field).split(/[^\p{L}\p{M}\p{N}]+/u)) {
      if (word) words.add(word);
    }
  }
  return [...words];
}
