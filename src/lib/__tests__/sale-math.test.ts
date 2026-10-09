import { describe, expect, it } from "vitest";
import {
  computeTotals,
  lineAmount,
  qtyByProduct,
  saleRecordIds,
} from "../sale-math";

describe("sale math", () => {
  it("prices a line from unit price and quantity, minus its discount", () => {
    expect(lineAmount({ qty: 3000, unitPrice: 5000, discount: 0 })).toBe(
      15_000,
    );
    expect(lineAmount({ qty: 1500, unitPrice: 12_000, discount: 500 })).toBe(
      17_500,
    ); // 1.5 kg
    expect(lineAmount({ qty: 1000, unitPrice: 100, discount: 999 })).toBe(0); // never negative
  });

  it("adds lines, applies the cart discount and splits paid / due", () => {
    const lines = [
      { qty: 2000, unitPrice: 5000, discount: 0 }, // 100
      { qty: 1000, unitPrice: 2550, discount: 50 }, // 25
    ];
    expect(computeTotals(lines, 500, 12_000)).toEqual({
      subtotal: 12_500,
      discount: 500,
      total: 12_000,
      creditUsed: 0,
      paid: 12_000,
      due: 0,
    });
    expect(computeTotals(lines, 0, 5_000)).toMatchObject({
      total: 12_500,
      paid: 5_000,
      due: 7_500,
    });
    expect(computeTotals(lines, 0, 0)).toMatchObject({ paid: 0, due: 12_500 });
  });

  it("caps discount and payment instead of going negative or giving change on the sale", () => {
    const lines = [{ qty: 1000, unitPrice: 1000, discount: 0 }];
    expect(computeTotals(lines, 99_999, 0)).toMatchObject({
      discount: 1000,
      total: 0,
      due: 0,
    });
    expect(computeTotals(lines, 0, 5_000)).toMatchObject({
      total: 1000,
      paid: 1000,
      due: 0,
    }); // 4000 is change
    expect(computeTotals(lines, -50, -5)).toMatchObject({
      discount: 0,
      paid: 0,
      due: 1000,
    });
  });

  it("is exact for awkward amounts", () => {
    const lines = [{ qty: 333, unitPrice: 9999, discount: 0 }]; // 0.333 × ৳99.99
    expect(computeTotals(lines, 0, 0).total).toBe(3330);
  });

  it("totals quantity per product across lines", () => {
    const totals = qtyByProduct([
      { productId: "a", qty: 1000 },
      { productId: "b", qty: 500 },
      { productId: "a", qty: 2000 },
    ]);
    expect(totals.get("a")).toBe(3000);
    expect(totals.get("b")).toBe(500);
  });

  it("derives stable record ids from the sale id", () => {
    expect(saleRecordIds.movement("S1", 2)).toBe("S1:m2");
    expect(saleRecordIds.movement("S1", 2)).toBe(
      saleRecordIds.movement("S1", 2),
    );
    expect(
      new Set([
        saleRecordIds.item("S1", 0),
        saleRecordIds.movement("S1", 0),
        saleRecordIds.ledger("S1"),
      ]).size,
    ).toBe(3);
  });
});

describe("store credit in a sale", () => {
  const lines = [{ qty: 4000, unitPrice: 5000, discount: 0 }]; // ৳200
  it("pays first; money received covers the rest; what is left is the due", () => {
    expect(computeTotals(lines, 0, 15_000, 5_000)).toMatchObject({
      total: 20_000,
      creditUsed: 5_000,
      paid: 15_000,
      due: 0,
    });
    expect(computeTotals(lines, 0, 0, 5_000)).toMatchObject({
      creditUsed: 5_000,
      paid: 0,
      due: 15_000,
    });
  });
  it("never uses more credit than the sale is worth, and ignores money beyond what is left", () => {
    expect(computeTotals(lines, 0, 99_999, 99_999)).toMatchObject({
      creditUsed: 20_000,
      paid: 0,
      due: 0,
    });
    expect(computeTotals(lines, 0, 99_999, 5_000)).toMatchObject({
      creditUsed: 5_000,
      paid: 15_000,
      due: 0,
    });
    expect(computeTotals(lines, 0, 0, -50)).toMatchObject({ creditUsed: 0 });
  });
});
