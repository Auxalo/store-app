import { describe, expect, it } from "vitest";
import { bnToEn, parseDecimal } from "../numerals";

describe("numerals", () => {
  it("converts Bangla digits to ASCII", () => {
    expect(bnToEn("১২৩৪৫৬৭৮৯০")).toBe("1234567890");
    expect(bnToEn("মূল্য ৳১২৫")).toBe("মূল্য ৳125");
  });

  it("parses mixed and formatted input", () => {
    expect(parseDecimal("১২৫০")).toBe(1250);
    expect(parseDecimal("1,25,000.50")).toBe(125000.5);
    expect(parseDecimal("১,২৫,০০০.৫০")).toBe(125000.5);
    expect(parseDecimal(" 12 ")).toBe(12);
    expect(parseDecimal(".5")).toBe(0.5);
  });

  it("rejects non-numbers", () => {
    for (const bad of ["", "-", "abc", "1.2.3", "12a", "1e5"]) {
      expect(parseDecimal(bad)).toBeNaN();
    }
  });
});
