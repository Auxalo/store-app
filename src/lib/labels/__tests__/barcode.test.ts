import { describe, expect, it } from "vitest";
import {
  C128_PATTERNS,
  checkDigit,
  code128Values,
  encodeBarcode,
  hasValidCheckDigit,
  makeStoreEan13,
  normalizeCode,
  QUIET_MODULES,
} from "../barcode";
import { barsImage, scan } from "./scan-helpers";

const encode = (code: string) => {
  const r = encodeBarcode(code);
  if (!r.ok) throw new Error(`no barcode for ${code}: ${r.problem}`);
  return r.barcode;
};

describe("which barcode a stored code becomes", () => {
  it("13 digits with a right check digit are EAN-13, 12 are UPC-A, 8 are EAN-8", () => {
    expect(encode("5901234123457").kind).toBe("ean13");
    expect(encode("036000291452").kind).toBe("upca");
    expect(encode("96385074").kind).toBe("ean8");
    // 95 modules for EAN-13 and UPC-A, 67 for EAN-8.
    expect(encode("5901234123457").modules).toHaveLength(95);
    expect(encode("036000291452").modules).toHaveLength(95);
    expect(encode("96385074").modules).toHaveLength(67);
  });

  it("a wrong check digit, or any other text, is Code 128: it scans back as exactly what was typed", () => {
    expect(encode("5901234123458").kind).toBe("code128");
    expect(encode("123456789013").kind).toBe("code128");
    expect(encode("ABC-123").kind).toBe("code128");
    expect(encode("5901234123458").text).toBe("5901234123458");
  });

  it("reads Bangla digits as 0-9 and ignores spaces round the code", () => {
    expect(normalizeCode("  ৫৯০১২৩৪১২৩৪৫৭ ")).toBe("5901234123457");
    expect(encode("৫৯০১২৩৪১২৩৪৫৭").kind).toBe("ean13");
  });

  it("says why there is no barcode", () => {
    expect(encodeBarcode("")).toEqual({ ok: false, problem: "EMPTY" });
    expect(encodeBarcode("   ")).toEqual({ ok: false, problem: "EMPTY" });
    expect(encodeBarcode("পণ্য")).toEqual({ ok: false, problem: "UNSUPPORTED" });
    expect(encodeBarcode("é")).toEqual({ ok: false, problem: "UNSUPPORTED" });
    expect(encodeBarcode("1".repeat(41))).toEqual({
      ok: false,
      problem: "TOO_LONG",
    });
  });
});

describe("check digits", () => {
  it("knows the right one", () => {
    expect(checkDigit("590123412345")).toBe(7);
    expect(checkDigit("03600029145")).toBe(2);
    expect(checkDigit("9638507")).toBe(4);
    expect(hasValidCheckDigit("5901234123457")).toBe(true);
    expect(hasValidCheckDigit("5901234123458")).toBe(false);
    expect(hasValidCheckDigit("12a4")).toBe(false);
  });
});

describe("Code 128 table", () => {
  it("every symbol is 11 modules wide, the stop is 13, and there are 106 symbols", () => {
    expect(C128_PATTERNS).toHaveLength(106);
    for (const [value, widths] of C128_PATTERNS.entries()) {
      expect(widths, `symbol ${value}`).toHaveLength(6);
      expect([...widths].reduce((sum, w) => sum + Number(w), 0)).toBe(11);
    }
  });

  it("uses the short digit mode for digit pairs and the long one for letters", () => {
    // Digits only, even count: Start C, three pairs, check digit: 5 symbols.
    const even = code128Values("123456");
    expect(even.slice(0, 4)).toEqual([105, 12, 34, 56]);
    expect(even).toHaveLength(5);
    // An odd count costs one switch (6 symbols); either way round is as short.
    expect(code128Values("12345")).toHaveLength(6);
    // Letters start in the long mode.
    expect(code128Values("AB")[0]).toBe(104);
    expect(code128Values("AB").slice(1, 3)).toEqual([33, 34]);
    // Letters then many digits: switches to the short mode for the digits.
    expect(code128Values("AB123456")).toContain(99);
  });
});

describe("a scanner reads every barcode back", () => {
  const codes = [
    "5901234123457", // EAN-13
    "4006381333931", // EAN-13
    "2000000000015", // shop-made style
    "036000291452", // UPC-A
    "96385074", // EAN-8
    "5901234123458", // wrong check digit → Code 128, digits
    "123", // short
    "ABC-123", // letters
    "SKU 00012/B", // mixed
    "000123456789", // leading zeros
    "123456789013", // 12 digits, wrong check digit
    "12345", // odd digits
    "9".repeat(20), // long digits
    "Milk-1L-FRESH-2026-LOT-0042-XYZ",
  ];

  for (const code of codes)
    it(`reads ${code}`, () => {
      const barcode = encode(code);
      // Two dots per module is the thinnest bar the labels print: the hardest case.
      for (const scale of [2, 3, 4]) {
        const img = barsImage(
          barcode.modules,
          QUIET_MODULES[barcode.kind],
          scale,
        );
        const result = scan(img);
        expect(result, `${code} at ${scale} dots`).not.toBeNull();
        expect(result?.text).toBe(code);
      }
    });
});

describe("a code of the shop's own", () => {
  it("starts with 2, has 13 digits and a right check digit, and scans", () => {
    for (let i = 0; i < 50; i++) {
      const code = makeStoreEan13();
      expect(code).toMatch(/^2\d{12}$/);
      expect(hasValidCheckDigit(code)).toBe(true);
      expect(encode(code).kind).toBe("ean13");
    }
    // The random source can be given, so a code can be checked exactly.
    expect(makeStoreEan13(() => 0)).toBe(
      `200000000000${checkDigit("200000000000")}`,
    );
    const a = new Set(Array.from({ length: 100 }, () => makeStoreEan13()));
    expect(a.size).toBeGreaterThan(95);
  });
});
