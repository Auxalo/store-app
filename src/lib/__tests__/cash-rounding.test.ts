import { describe, expect, it } from "vitest";
import {
  cashRounding,
  computeTotals,
  itemCount,
  roundingFor,
} from "../sale-math";

describe("cash rounding (euro: to 0 or 5 cents)", () => {
  it.each([
    [509, 510],
    [6502, 6500],
    [6501, 6500],
    [503, 505],
    [504, 505],
    [506, 505],
    [507, 505],
    [517, 515],
    [518, 520],
    [500, 500],
    [505, 505],
    [0, 0],
  ])("%i cents becomes %i", (amount, rounded) => {
    expect(amount + cashRounding(amount, 5)).toBe(rounded);
  });

  it("does nothing for a currency that does not round", () => {
    expect(cashRounding(509, 0)).toBe(0);
  });

  it("rounds only the total, after discounts, never the lines", () => {
    const lines = [
      { qty: 1000, unitPrice: 333, discount: 0 },
      { qty: 2000, unitPrice: 101, discount: 0 },
    ]; // 3,33 + 2,02 = 5,35, minus 0,26 discount = 5,09
    const rounding = roundingFor(lines, 26, 5);
    expect(rounding).toBe(1);
    const t = computeTotals(lines, 26, 1000, 0, rounding);
    expect(t).toMatchObject({
      subtotal: 535,
      discount: 26,
      rounding: 1,
      total: 510,
      paid: 510,
      due: 0,
    });
  });

  it("older sales and other currencies have no rounding", () => {
    const t = computeTotals([{ qty: 1000, unitPrice: 509, discount: 0 }], 0, 0);
    expect(t.rounding).toBe(0);
    expect(t.total).toBe(509);
  });
});

describe("item count on the receipt", () => {
  it("counts pieces, and a weighed line as one", () => {
    expect(itemCount([{ qty: 3000 }, { qty: 2000 }, { qty: 1250 }])).toBe(6);
  });
});
