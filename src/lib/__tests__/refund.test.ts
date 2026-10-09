import { describe, expect, it } from "vitest";
import {
  creditShare,
  defaultSplit,
  isFullyReturned,
  lineNets,
  refundAmounts,
  refundFor,
  resolveSplit,
  returnedOf,
  returnSplit,
} from "../refund";
import { computeTotals } from "../sale-math";

const item = (qty: number, unitPrice: number, discount = 0) => ({
  qty,
  unitPrice,
  discount,
});

describe("what the customer really paid, line by line", () => {
  it("is the price times the quantity when there is no discount", () => {
    expect(lineNets([item(2000, 5000), item(1000, 3000)], 0)).toEqual([
      10_000, 3_000,
    ]);
  });

  it("takes a line's own discount off that line", () => {
    expect(lineNets([item(2000, 5000, 2000)], 0)).toEqual([8_000]);
  });

  it("shares the bill discount by value and adds up to the sale's total exactly", () => {
    const lines = [item(1000, 3333), item(1000, 3333), item(1000, 3334)]; // ৳100.00 in all
    const nets = lineNets(lines, 1000);
    const { total } = computeTotals(lines, 1000, 0);
    expect(nets.reduce((a, b) => a + b, 0)).toBe(total);
    expect(total).toBe(9_000);
  });

  it("never discounts below zero", () => {
    expect(lineNets([item(1000, 500)], 99_999)).toEqual([0]);
  });
});

describe("the refund for returning part of a line", () => {
  it("is in proportion to what the line cost", () => {
    expect(refundFor(8_000, 4000, 0, 1000)).toBe(2_000);
  });

  it("adds up to exactly the line's cost over several returns, never more", () => {
    // ৳80.00 for 3 units does not divide evenly: 26.67 each.
    const net = 8_000;
    const first = refundFor(net, 3000, 0, 1000);
    const second = refundFor(net, 3000, 1000, 1000);
    const third = refundFor(net, 3000, 2000, 1000);
    expect(first + second + third).toBe(net);
    expect([first, second, third].every((n) => n >= 2666 && n <= 2667)).toBe(
      true,
    );
  });

  it("refunds a whole discounted sale for exactly what was paid", () => {
    const lines = [item(3000, 5000), item(1000, 3000)];
    const amounts = refundAmounts(lines, 1800, new Map(), [
      { itemIndex: 0, qty: 3000 },
      { itemIndex: 1, qty: 1000 },
    ]);
    const { total } = computeTotals(lines, 1800, 0);
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("counts earlier returns of the same line", () => {
    const lines = [item(2000, 5000)];
    const first = refundAmounts(lines, 1000, new Map(), [
      { itemIndex: 0, qty: 1000 },
    ]);
    const second = refundAmounts(lines, 1000, new Map([[0, 1000]]), [
      { itemIndex: 0, qty: 1000 },
    ]);
    expect(first[0] + second[0]).toBe(9_000); // ৳100.00 less ৳10.00 discount
  });

  it("an item that does not exist refunds nothing", () => {
    expect(
      refundAmounts([], 0, new Map(), [{ itemIndex: 3, qty: 1000 }]),
    ).toEqual([0]);
  });
});

describe("what earlier returns already did (cancelling must not repeat it)", () => {
  it("counts goods put back and money taken off the due", () => {
    const done = returnedOf([
      {
        lines: [{ itemIndex: 0, qty: 3000 }],
        settlement: "credit",
        restock: true,
        total: 15_000,
      },
      {
        lines: [{ itemIndex: 0, qty: 500 }],
        settlement: "cash",
        restock: true,
        total: 2_500,
      },
    ]);
    expect(done.restocked.get(0)).toBe(3500);
    expect(done.credited).toBe(15_000);
  });

  it("goods returned damaged were not put back", () => {
    const done = returnedOf([
      {
        lines: [{ itemIndex: 1, qty: 1000 }],
        settlement: "cash",
        restock: false,
        total: 5_000,
      },
    ]);
    expect(done.restocked.size).toBe(0);
    expect(done.credited).toBe(0);
  });
});

describe("a sale that has come back in full", () => {
  const back = (itemIndex: number, qty: number) => ({
    lines: [{ itemIndex, qty }],
  });
  it("is recognised only when every line is back", () => {
    expect(isFullyReturned([3000], [back(0, 3000)])).toBe(true);
    expect(isFullyReturned([3000], [back(0, 1000), back(0, 2000)])).toBe(true);
    expect(isFullyReturned([3000, 1000], [back(0, 3000)])).toBe(false);
    expect(isFullyReturned([3000], [back(0, 2999)])).toBe(false);
    expect(isFullyReturned([3000], [])).toBe(false);
    expect(isFullyReturned([], [])).toBe(false);
  });
});

describe("how a refund is settled", () => {
  it("clears what is owed first and hands back only the rest", () => {
    const has = { hasParty: true };
    expect(defaultSplit(60_000, 56_000, has)).toEqual({
      credited: 56_000,
      cashBack: 4_000,
    });
    expect(defaultSplit(20_000, 56_000, has)).toEqual({
      credited: 20_000,
      cashBack: 0,
    });
    // Nothing owed, or already paid ahead: all cash, unless kept as credit.
    expect(defaultSplit(20_000, 0, has)).toEqual({
      credited: 0,
      cashBack: 20_000,
    });
    expect(defaultSplit(20_000, -5_000, has)).toEqual({
      credited: 0,
      cashBack: 20_000,
    });
    expect(defaultSplit(20_000, 0, { ...has, keepAsCredit: true })).toEqual({
      credited: 20_000,
      cashBack: 0,
    });
    // A walk-in sale has nobody to credit.
    expect(
      defaultSplit(20_000, 0, { hasParty: false, keepAsCredit: true }),
    ).toEqual({ credited: 0, cashBack: 20_000 });
  });

  it("gives back the store credit a sale used as credit, not as cash", () => {
    const has = { hasParty: true, creditShare: 5_000 };
    expect(defaultSplit(20_000, 0, has)).toEqual({
      credited: 5_000,
      cashBack: 15_000,
    });
    // and still clears a due first
    expect(defaultSplit(20_000, 8_000, has)).toEqual({
      credited: 13_000,
      cashBack: 7_000,
    });
  });

  it("spreads the credit used over the returns of a sale, adding up exactly", () => {
    // a ৳200 sale that used ৳50 of store credit, returned in three parts
    const parts = [6_000, 7_001, 6_999];
    let before = 0;
    let given = 0;
    for (const part of parts) {
      given += creditShare(5_000, 20_000, before, part);
      before += part;
    }
    expect(before).toBe(20_000);
    expect(given).toBe(5_000);
    expect(creditShare(0, 20_000, 0, 5_000)).toBe(0);
  });

  it("resolves the split a return is saved with, old or new", () => {
    expect(resolveSplit(10_000, { cashBack: 4_000 }, true)).toEqual({
      cashBack: 4_000,
      credited: 6_000,
    });
    // never more cash than the refund, never negative
    expect(resolveSplit(10_000, { cashBack: 99_999 }, true)).toEqual({
      cashBack: 10_000,
      credited: 0,
    });
    expect(resolveSplit(10_000, { cashBack: -5 }, true)).toEqual({
      cashBack: 0,
      credited: 10_000,
    });
    // older devices: all cash or all credit
    expect(resolveSplit(10_000, { settlement: "credit" }, true)).toEqual({
      cashBack: 0,
      credited: 10_000,
    });
    expect(resolveSplit(10_000, { settlement: "cash" }, true)).toEqual({
      cashBack: 10_000,
      credited: 0,
    });
    // nobody to credit: cash
    expect(resolveSplit(10_000, { cashBack: 0 }, false)).toEqual({
      cashBack: 10_000,
      credited: 0,
    });
    expect(returnSplit({ total: 10_000, cashBack: 2_500 })).toEqual({
      cashBack: 2_500,
      credited: 7_500,
    });
    expect(returnSplit({ total: 10_000, settlement: "credit" })).toEqual({
      cashBack: 0,
      credited: 10_000,
    });
  });
});
