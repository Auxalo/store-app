import { describe, expect, it } from "vitest";
import type { ReturnDoc } from "@/db/local/types";
import { dayKey, type SaleWithItems, summarize } from "../compute";

/**
 * Reports must add up whatever mix of cash, credit, store credit and returns a period had:
 *   net sales = money received + paid from store credit + left unpaid
 * where received = paid at the sales − cash handed back, and left unpaid = due − refunds that came
 * off the dues. This is the identity the bug reports found broken (unpaid never went down).
 */

const today = dayKey(Date.now());
const at = new Date().toISOString();

let n = 0;
const sale = (
  total: number,
  parts: { paid: number; due: number; creditUsed?: number },
): SaleWithItems =>
  ({
    id: `s${++n}`,
    status: "active",
    createdAt: at,
    subtotal: total,
    discount: 0,
    total,
    paid: parts.paid,
    due: parts.due,
    creditUsed: parts.creditUsed ?? 0,
    paymentMethod: "cash",
    items: [
      {
        id: `s${n}:i0`,
        productId: "p",
        productName: "Milk",
        productNameBn: "",
        unit: "pcs",
        qty: 1000,
        listPrice: total,
        unitPrice: total,
        unitCost: 0,
        discount: 0,
        lineTotal: total,
      },
    ],
  }) as unknown as SaleWithItems;

const ret = (
  saleDoc: SaleWithItems,
  total: number,
  how: { cashBack: number } | { settlement: "cash" | "credit" },
  kind: "sale" | "purchase" = "sale",
): ReturnDoc =>
  ({
    id: `r${++n}`,
    kind,
    refId: saleDoc.id,
    createdAt: at,
    total,
    restock: true,
    lines: [
      {
        itemIndex: 0,
        productId: "p",
        qty: 1000,
        unitAmount: total,
        amount: total,
      },
    ],
    ...how,
  }) as unknown as ReturnDoc;

function report(sales: SaleWithItems[], returns: ReturnDoc[]) {
  const byId = new Map(sales.map((s) => [s.id, s]));
  return summarize({
    range: { from: today, to: today },
    sales,
    returns,
    expenses: [],
    purchases: [],
    findSale: (id) => byId.get(id),
    categoryOf: () => null,
  });
}

const identity = (s: ReturnType<typeof summarize>) =>
  s.received + s.creditUsed + s.unpaid;

describe("reports after returns", () => {
  it("a return that comes off the due brings 'left unpaid' down (the reported bug)", () => {
    // ৳560 sold on credit, the customer then returns goods worth ৳560 against that due.
    const a = sale(56_000, { paid: 0, due: 56_000 });
    const s = report([a], [ret(a, 56_000, { cashBack: 0 })]);
    expect(s.netSales).toBe(0);
    expect(s.unpaid).toBe(0);
    expect(s.received).toBe(0);
    expect(identity(s)).toBe(s.netSales);
  });

  it("cash handed back lowers money received, not the due", () => {
    const a = sale(20_000, { paid: 20_000, due: 0 });
    const s = report([a], [ret(a, 20_000, { cashBack: 20_000 })]);
    expect(s.received).toBe(0);
    expect(s.cashBack).toBe(20_000);
    expect(s.unpaid).toBe(0);
    expect(identity(s)).toBe(s.netSales);
  });

  it("a refund above what was owed becomes store credit, shown as a negative 'unpaid'", () => {
    // ৳200 sale, ৳150 paid, ৳50 owed; everything returned: ৳50 clears the due, ৳150 goes back as
    // store credit (kept), none in cash.
    const a = sale(20_000, { paid: 15_000, due: 5_000 });
    const s = report([a], [ret(a, 20_000, { cashBack: 0 })]);
    expect(s.credited).toBe(20_000);
    expect(s.unpaid).toBe(5_000 - 20_000); // -15,000: credit the customer now has
    expect(s.received).toBe(15_000);
    expect(identity(s)).toBe(s.netSales);
  });

  it("store credit used at a sale counts as paid, not as owed", () => {
    const a = sale(20_000, { paid: 15_000, due: 0, creditUsed: 5_000 });
    const s = report([a], []);
    expect(s.creditUsed).toBe(5_000);
    expect(s.unpaid).toBe(0);
    expect(identity(s)).toBe(s.netSales);
  });

  it("older returns that only said cash or credit still add up", () => {
    const a = sale(10_000, { paid: 0, due: 10_000 });
    const b = sale(10_000, { paid: 10_000, due: 0 });
    const s = report(
      [a, b],
      [
        ret(a, 4_000, { settlement: "credit" }),
        ret(b, 3_000, { settlement: "cash" }),
      ],
    );
    expect(s.credited).toBe(4_000);
    expect(s.cashBack).toBe(3_000);
    expect(identity(s)).toBe(s.netSales);
  });

  it("holds for a mix of everything", () => {
    const a = sale(30_000, { paid: 10_000, due: 15_000, creditUsed: 5_000 });
    const b = sale(12_000, { paid: 12_000, due: 0 });
    const c = sale(8_000, { paid: 0, due: 8_000 });
    const s = report(
      [a, b, c],
      [
        ret(a, 9_000, { cashBack: 2_000 }),
        ret(b, 5_000, { cashBack: 5_000 }),
        ret(c, 8_000, { cashBack: 0 }),
      ],
    );
    expect(identity(s)).toBe(s.netSales);
    expect(s.netSales).toBe(50_000 - 22_000);
  });

  it("returns to suppliers are counted on their own, not as sales returns", () => {
    const a = sale(10_000, { paid: 10_000, due: 0 });
    const s = report([a], [ret(a, 7_000, { cashBack: 7_000 }, "purchase")]);
    expect(s.purchaseReturns).toBe(7_000);
    expect(s.returns).toBe(0);
    expect(s.netSales).toBe(10_000);
    expect(s.cashBack).toBe(0);
  });
});
