import type { StoreDB } from "@/db/local/db";
import {
  buildCash,
  type CashEntryRow,
  type CashInputs,
  type CashReport,
  type MoneyFlow,
  moneyFlow,
  returnsWithMethod,
} from "./cash";
import { type DayRange, rangeBounds } from "./compute";

/** How many earlier days the drawer card remembers openings for. */
export const DRAWER_HISTORY_DAYS = 14;

const addDays = (day: string, delta: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

/** What moved money in the days of `range` (made in them, or cancelled in them), from this device. */
export async function loadFlowInputs(
  db: StoreDB,
  range: DayRange,
  timeZone: string,
): Promise<CashInputs> {
  const { start, end } = rangeBounds(range, timeZone);
  const inRange = (iso: string | null | undefined) =>
    !!iso && iso >= start && iso < end;

  const [
    salesMade,
    salesVoided,
    paymentsMade,
    paymentsVoided,
    expensesMade,
    expensesVoided,
    purchases,
    returns,
  ] = await Promise.all([
    db.sales.where("createdAt").between(start, end, true, false).toArray(),
    db.sales
      .where("status")
      .equals("voided")
      .filter((s) => inRange(s.voidedAt))
      .toArray(),
    db.payments.where("createdAt").between(start, end, true, false).toArray(),
    db.payments.where("voidedAt").between(start, end, true, false).toArray(),
    db.expenses.where("createdAt").between(start, end, true, false).toArray(),
    db.expenses
      .where("status")
      .equals("voided")
      .filter((e) => inRange(e.updatedAt))
      .toArray(),
    db.purchases.where("createdAt").between(start, end, true, false).toArray(),
    db.returns.where("createdAt").between(start, end, true, false).toArray(),
  ]);

  // A refund moves money the way its bill was paid, so look the bills up.
  const idsOf = (kind: "sale" | "purchase") => [
    ...new Set(returns.filter((r) => r.kind === kind).map((r) => r.refId)),
  ];
  const [saleBills, purchaseBills] = await Promise.all([
    db.sales.bulkGet(idsOf("sale")),
    db.purchases.bulkGet(idsOf("purchase")),
  ]);
  const methods = (
    bills: Array<{ id: string; paymentMethod: string } | undefined>,
  ) => new Map(bills.flatMap((b) => (b ? [[b.id, b.paymentMethod]] : [])));

  const unique = <T extends { id: string }>(...lists: T[][]) => [
    ...new Map(lists.flat().map((x) => [x.id, x])).values(),
  ];
  return {
    sales: unique(salesMade, salesVoided),
    payments: unique(paymentsMade, paymentsVoided),
    expenses: unique(expensesMade, expensesVoided),
    purchases,
    returns: returnsWithMethod(
      returns,
      methods(saleBills),
      methods(purchaseBills),
    ),
  };
}

/** The cash drawer's day, worked out from what is on this device. */
export async function loadCash(
  db: StoreDB,
  day: string,
  timeZone: string,
): Promise<CashReport> {
  const [inputs, entries] = await Promise.all([
    loadFlowInputs(db, { from: day, to: day }, timeZone),
    db.cashDrawer
      .where("day")
      .between(addDays(day, -DRAWER_HISTORY_DAYS), day, true, true)
      .toArray(),
  ]);
  const rows: CashEntryRow[] = entries.map((e) => ({
    id: e.id,
    day: e.day,
    amount: e.amount,
    kind: e.kind,
    note: e.note,
    byName: e.byName,
    createdAt: e.createdAt,
  }));
  return buildCash(day, timeZone, inputs, rows);
}

/** Money in and out for the days of `range`, by payment method, from this device. */
export async function loadMoney(
  db: StoreDB,
  range: DayRange,
  timeZone: string,
): Promise<MoneyFlow> {
  return moneyFlow(range, timeZone, await loadFlowInputs(db, range, timeZone));
}
