import { describe, expect, it } from "vitest";
import { normalizeSearch, searchWords } from "../search";

describe("search", () => {
  it("normalizes case, digits, joiners and whitespace", () => {
    expect(normalizeSearch("  Fresh   MILK ")).toBe("fresh milk");
    expect(normalizeSearch("কোক ৫০০ml")).toBe("কোক 500ml");
    // ZWNJ/ZWJ differ between keyboards and must not break matching
    expect(normalizeSearch("ক‍্ষ")).toBe(normalizeSearch("ক্ষ"));
  });

  it("builds unique words across English, Bangla, SKU and barcode", () => {
    const words = searchWords(
      "Fresh Milk 500ml",
      "ফ্রেশ দুধ",
      "MLK-001",
      "8901234567890",
    );
    expect(words).toEqual(
      expect.arrayContaining([
        "fresh",
        "milk",
        "500ml",
        "ফ্রেশ",
        "দুধ",
        "mlk",
        "001",
        "8901234567890",
      ]),
    );
    expect(new Set(words).size).toBe(words.length);
  });

  it("keeps Bangla combining marks inside words", () => {
    expect(searchWords("দুধ")).toEqual(["দুধ"]);
    expect(searchWords("কোকাকোলা")).toEqual(["কোকাকোলা"]);
  });

  it("ignores empty fields", () => {
    expect(searchWords(undefined, null, "")).toEqual([]);
  });
});
