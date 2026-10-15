import type { StoreDB } from "@/db/local/db";
import { buildCash, type CashEntryRow, type CashReport } from "./cash";
import { rangeBounds } from "./compute";

/** How many earlier days the drawer card remembers openings for. */
export const DRAWER_HISTORY_DAYS = 14;

const addDays = (day: string, delta: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

/** The cash drawer's day, worked out from what is on this device. */
export async function loadCash(
  db: StoreDB,
  day: string,
  timeZone: string,
): Promise<CashReport> {
  const { start, end } = rangeBounds({ from: day, to: day }, timeZone);
  const inDay = (iso: string | null | undefined) =>
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
    entries,
  ] = await Promise.all([
    db.sales.where("createdAt").between(start, end, true, false).toArray(),
    db.sales
      .where("status")
      .equals("voided")
      .filter((s) => inDay(s.voidedAt))
      .toArray(),
    db.payments.where("createdAt").between(start, end, true, false).toArray(),
    db.payments.where("voidedAt").between(start, end, true, false).toArray(),
    db.expenses.where("createdAt").between(start, end, true, false).toArray(),
    db.expenses
      .where("status")
      .equals("voided")
      .filter((e) => inDay(e.updatedAt))
      .toArray(),
    db.purchases.where("createdAt").between(start, end, true, false).toArray(),
    db.returns.where("createdAt").between(start, end, true, false).toArray(),
    db.cashDrawer
      .where("day")
      .between(addDays(day, -DRAWER_HISTORY_DAYS), day, true, true)
      .toArray(),
  ]);

  const unique = <T extends { id: string }>(...lists: T[][]) => [
    ...new Map(lists.flat().map((x) => [x.id, x])).values(),
  ];
  const rows: CashEntryRow[] = entries.map((e) => ({
    id: e.id,
    day: e.day,
    amount: e.amount,
    kind: e.kind,
    note: e.note,
    byName: e.byName,
    createdAt: e.createdAt,
  }));
  return buildCash(
    day,
    timeZone,
    {
      sales: unique(salesMade, salesVoided),
      payments: unique(paymentsMade, paymentsVoided),
      expenses: unique(expensesMade, expensesVoided),
      purchases,
      returns,
    },
    rows,
  );
}
