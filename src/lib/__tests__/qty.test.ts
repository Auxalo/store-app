import { describe, expect, it } from "vitest";
import { lineTotal, parseQty, roundToUnit, toMilli } from "../qty";

describe("qty", () => {
  it("parses to milli-units", () => {
    expect(parseQty("1.5")).toBe(1500);
    expect(parseQty("১.৫")).toBe(1500);
    expect(parseQty("3")).toBe(3000);
    expect(parseQty("0.001")).toBe(1);
    expect(parseQty("-1")).toBeNull();
    expect(parseQty("x")).toBeNull();
  });

  it("computes line totals exactly", () => {
    // ৳120.00/kg × 1.5kg
    expect(lineTotal(12_000, 1500)).toBe(18_000);
    // ৳33.33/pc × 3
    expect(lineTotal(3333, 3000)).toBe(9999);
    // ৳99.99/kg × 0.333kg = 33.29667 → 33.30
    expect(lineTotal(9999, 333)).toBe(3330);
  });

  it("rounds to unit decimals", () => {
    expect(roundToUnit(1500, 0)).toBe(2000);
    expect(roundToUnit(1499, 0)).toBe(1000);
    expect(roundToUnit(1234, 2)).toBe(1230);
    expect(roundToUnit(1234, 3)).toBe(1234);
    expect(toMilli(0.1 + 0.2)).toBe(300);
  });
});
