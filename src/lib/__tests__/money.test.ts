import { describe, expect, it } from "vitest";
import { divRound, parseMoney, percentOf, toPoisha } from "../money";

describe("money", () => {
  it("parses taka strings to exact poisha", () => {
    expect(parseMoney("125.50")).toBe(12550);
    expect(parseMoney("১২৫.৫০")).toBe(12550);
    expect(parseMoney("0.1")).toBe(10);
    expect(parseMoney("1,250")).toBe(125000);
    expect(parseMoney("1.005")).toBe(101);
    expect(parseMoney("1.004")).toBe(100);
    expect(parseMoney("-5")).toBe(-500);
  });

  it("rejects invalid input", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
  });

  it("avoids float drift", () => {
    expect(toPoisha(0.1 + 0.2)).toBe(30);
    expect(toPoisha(19.99)).toBe(1999);
  });

  it("rounds half away from zero", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(4, 3)).toBe(1);
    expect(divRound(-1, 1000)).toBe(0);
  });

  it("computes percentages in basis points", () => {
    expect(percentOf(100_000, 1000)).toBe(10_000); // 10% of ৳1000
    expect(percentOf(12_345, 750)).toBe(926); // 7.5% of ৳123.45 = 9.25875
  });
});
