import { describe, expect, it } from "vitest";
import { computeTotals, priceCut } from "../sale-math";

describe("priceCut", () => {
  it("is what a lowered price takes off, for the whole quantity", () => {
    // Milk listed at ৳90, sold at ৳80, two pieces: ৳20 off.
    expect(priceCut({ qty: 2000, listPrice: 9000, unitPrice: 8000 })).toBe(
      2000,
    );
  });

  it("is 0 when the price is the list price or raised", () => {
    expect(priceCut({ qty: 2000, listPrice: 9000, unitPrice: 9000 })).toBe(0);
    expect(priceCut({ qty: 2000, listPrice: 9000, unitPrice: 10000 })).toBe(0);
  });

  it("handles loose quantities", () => {
    // ৳50 a kilo cut to ৳45, 1.5 kg: ৳7.50 off.
    expect(priceCut({ qty: 1500, listPrice: 5000, unitPrice: 4500 })).toBe(750);
  });

  it("gives the same total whether the cut is a price or a discount", () => {
    const asPrice = computeTotals(
      [
        { qty: 2000, unitPrice: 8000, discount: 0 },
        { qty: 1000, unitPrice: 4000, discount: 0 },
      ],
      500,
      Number.MAX_SAFE_INTEGER,
    );
    const asDiscount = computeTotals(
      [
        { qty: 2000, unitPrice: 9000, discount: 0 },
        { qty: 1000, unitPrice: 5000, discount: 0 },
      ],
      500 + 2000 + 1000,
      Number.MAX_SAFE_INTEGER,
    );
    expect(asDiscount.total).toBe(asPrice.total);
    expect(asDiscount.due).toBe(asPrice.due);
  });
});
