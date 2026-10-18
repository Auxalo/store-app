import { describe, expect, it } from "vitest";
import {
  type CashInputs,
  cashFlow,
  moneyFlow,
  returnsWithMethod,
} from "../cash";

/**
 * Money in and out: every payment method on its own and all together, over any days. The same
 * records give the cash drawer its cash line, so the Money page and the drawer cannot disagree.
 */

const TZ = "Asia/Dhaka";
// Noon in Dhaka on the given October 2026 day.
const noon = (day: number) =>
  new Date(Date.UTC(2026, 9, day, 6, 0, 0)).toISOString();

const none: CashInputs = {
  sales: [],
  payments: [],
  expenses: [],
  purchases: [],
  returns: [],
};
const range = (from: number, to = from) => ({
  from: `2026-10-${String(from).padStart(2, "0")}`,
  to: `2026-10-${String(to).padStart(2, "0")}`,
});

describe("moneyFlow", () => {
  it("counts what was actually paid, per method and together, in and out", () => {
    const flow = moneyFlow(range(5), TZ, {
      ...none,
      sales: [
        // A ৳7,000 bill of which ৳5,000 was paid (in bKash): ৳5,000 came in.
        { paid: 500_000, paymentMethod: "bkash", createdAt: noon(5) },
        { paid: 200_000, paymentMethod: "cash", createdAt: noon(5) },
      ],
      payments: [
        {
          partyType: "customer",
          amount: 100_000,
          method: "nagad",
          createdAt: noon(5),
        },
        {
          partyType: "supplier",
          amount: 150_000,
          method: "cash",
          createdAt: noon(5),
        },
      ],
      expenses: [
        {
          amount: 30_000,
          method: "cash",
          createdAt: noon(5),
          updatedAt: noon(5),
        },
      ],
      purchases: [{ paid: 120_000, paymentMethod: "bank", createdAt: noon(5) }],
    });
    expect(flow.all).toMatchObject({
      sales: 700_000,
      customerPayments: 100_000,
      totalIn: 800_000,
      supplierPayments: 150_000,
      expenses: 30_000,
      purchases: 120_000,
      totalOut: 300_000,
    });
    expect(flow.methods.bkash).toMatchObject({ totalIn: 500_000, totalOut: 0 });
    expect(flow.methods.nagad).toMatchObject({ totalIn: 100_000, totalOut: 0 });
    expect(flow.methods.cash).toMatchObject({
      totalIn: 200_000,
      totalOut: 180_000,
    });
    expect(flow.methods.bank).toMatchObject({ totalIn: 0, totalOut: 120_000 });
    expect(flow.methods.rocket).toMatchObject({ totalIn: 0, totalOut: 0 });
    // The methods add up to the whole.
    const sum = (key: "totalIn" | "totalOut") =>
      Object.values(flow.methods).reduce((s, m) => s + m[key], 0);
    expect(sum("totalIn")).toBe(flow.all.totalIn);
    expect(sum("totalOut")).toBe(flow.all.totalOut);
  });

  it("covers every day of the range and nothing outside it, by the shop's days", () => {
    const sale = (createdAt: string) => ({
      paid: 100,
      paymentMethod: "cash",
      createdAt,
    });
    const input = {
      ...none,
      sales: [
        sale(noon(3)),
        sale(noon(4)),
        sale(noon(6)),
        // 01:00 on the 5th in Dhaka is still the 4th in UTC.
        sale(new Date(Date.UTC(2026, 9, 4, 19, 0, 0)).toISOString()),
      ],
    };
    expect(moneyFlow(range(4, 5), TZ, input).all.sales).toBe(200);
    expect(moneyFlow(range(5), TZ, input).all.sales).toBe(100);
    expect(moneyFlow(range(3, 6), TZ, input).all.sales).toBe(400);
  });

  it("a cancellation counts back on the day it was cancelled; made and cancelled in the same days is nothing", () => {
    const input: CashInputs = {
      ...none,
      sales: [
        // Made on the 2nd, cancelled on the 5th.
        {
          paid: 400,
          paymentMethod: "cash",
          status: "voided",
          createdAt: noon(2),
          voidedAt: noon(5),
        },
        // Made and cancelled on the 5th.
        {
          paid: 900,
          paymentMethod: "cash",
          status: "voided",
          createdAt: noon(5),
          voidedAt: noon(5),
        },
      ],
      payments: [
        {
          partyType: "customer",
          amount: 250,
          method: "bkash",
          status: "voided",
          createdAt: noon(2),
          voidedAt: noon(5),
        },
      ],
      expenses: [
        {
          amount: 70,
          method: "cash",
          status: "voided",
          createdAt: noon(2),
          updatedAt: noon(5),
        },
      ],
    };
    // The 2nd saw the money come in; the 5th sees it go back.
    expect(moneyFlow(range(2), TZ, input).all.totalIn).toBe(400 + 250);
    const fifth = moneyFlow(range(5), TZ, input);
    expect(fifth.all.sales).toBe(-400);
    expect(fifth.all.customerPayments).toBe(-250);
    expect(fifth.all.expenses).toBe(-70);
    expect(fifth.methods.bkash.customerPayments).toBe(-250);
    // Over both days it nets out to nothing.
    expect(moneyFlow(range(2, 5), TZ, input).all).toMatchObject({
      sales: 0,
      customerPayments: 0,
      expenses: 0,
    });
  });

  it("a refund moves money the way its bill was paid", () => {
    const returns = returnsWithMethod(
      [
        { kind: "sale" as const, refId: "s1", cashBack: 700 },
        { kind: "sale" as const, refId: "gone", cashBack: 50 },
        { kind: "purchase" as const, refId: "p1", cashBack: 300 },
      ],
      new Map([["s1", "bkash"]]),
      new Map([["p1", "bank"]]),
    );
    expect(returns.map((r) => r.method)).toEqual(["bkash", "cash", "bank"]);
    const flow = moneyFlow(range(5), TZ, {
      ...none,
      returns: returns.map((r) => ({
        ...r,
        total: r.cashBack,
        settlement: "cash" as const,
        createdAt: noon(5),
      })),
    });
    expect(flow.methods.bkash.customerRefunds).toBe(700);
    expect(flow.methods.cash.customerRefunds).toBe(50);
    expect(flow.methods.bank.supplierRefunds).toBe(300);
    expect(flow.all.totalOut).toBe(750);
    expect(flow.all.totalIn).toBe(300);
  });

  it("the cash line is the drawer's cash, and a bKash refund no longer comes out of the drawer", () => {
    const input: CashInputs = {
      ...none,
      sales: [{ paid: 1_000, paymentMethod: "cash", createdAt: noon(5) }],
      returns: [
        {
          kind: "sale",
          total: 400,
          cashBack: 400,
          settlement: "cash",
          createdAt: noon(5),
          method: "bkash",
        },
        {
          kind: "sale",
          total: 100,
          cashBack: 100,
          settlement: "cash",
          createdAt: noon(5),
        },
      ],
    };
    const drawer = cashFlow("2026-10-05", TZ, input);
    expect(drawer).toEqual(moneyFlow(range(5), TZ, input).methods.cash);
    expect(drawer).toMatchObject({ totalIn: 1_000, totalOut: 100 });
  });

  it("an empty range is all zeros", () => {
    const flow = moneyFlow(range(5), TZ, none);
    expect(flow.all.totalIn).toBe(0);
    expect(flow.all.totalOut).toBe(0);
    for (const m of Object.values(flow.methods)) expect(m.totalIn).toBe(0);
  });
});
