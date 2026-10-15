import type { Db } from "mongodb";
import {
  buildCash,
  type CashEntryRow,
  type CashExpense,
  type CashPayment,
  type CashPurchase,
  type CashReport,
  type CashReturn,
  type CashSale,
} from "@/reports/cash";
import { rangeBounds } from "@/reports/compute";

const HISTORY_DAYS = 14;
const MAX_TIME_MS = 8_000;

const addDays = (day: string, delta: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

/** The cash drawer's day, from the server's copy of the shop (same rules as the device: src/reports/cash.ts). */
export async function serverCash(
  db: Db,
  storeId: string,
  day: string,
  timeZone: string,
): Promise<CashReport> {
  const { start, end } = rangeBounds({ from: day, to: day }, timeZone);
  const made = { storeId, createdAt: { $gte: start, $lt: end } };
  const find = <T>(
    collection: string,
    filter: object,
    projection: Record<string, 1>,
  ) =>
    db
      .collection(collection)
      .find(filter, { projection })
      .maxTimeMS(MAX_TIME_MS)
      .toArray() as unknown as Promise<Array<T & { _id: string }>>;
  const merge = <T extends { _id: string }>(...lists: T[][]) => [
    ...new Map(lists.flat().map((x) => [String(x._id), x])).values(),
  ];

  const saleFields = {
    paid: 1,
    paymentMethod: 1,
    status: 1,
    createdAt: 1,
    voidedAt: 1,
  } as const;
  const paymentFields = {
    partyType: 1,
    amount: 1,
    method: 1,
    status: 1,
    createdAt: 1,
    voidedAt: 1,
  } as const;
  const expenseFields = {
    amount: 1,
    method: 1,
    status: 1,
    createdAt: 1,
    updatedAt: 1,
  } as const;

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
    find<CashSale>("sales", made, saleFields),
    find<CashSale>(
      "sales",
      { storeId, status: "voided", voidedAt: { $gte: start, $lt: end } },
      saleFields,
    ),
    find<CashPayment>("payments", made, paymentFields),
    find<CashPayment>(
      "payments",
      { storeId, voidedAt: { $gte: start, $lt: end } },
      paymentFields,
    ),
    find<CashExpense>("expenses", made, expenseFields),
    find<CashExpense>(
      "expenses",
      { storeId, status: "voided", updatedAt: { $gte: start, $lt: end } },
      expenseFields,
    ),
    find<CashPurchase>("purchases", made, {
      paid: 1,
      paymentMethod: 1,
      createdAt: 1,
    }),
    find<CashReturn>("returns", made, {
      kind: 1,
      total: 1,
      cashBack: 1,
      credited: 1,
      settlement: 1,
      createdAt: 1,
    }),
    find<Omit<CashEntryRow, "id">>(
      "cashDrawer",
      { storeId, day: { $gte: addDays(day, -HISTORY_DAYS), $lte: day } },
      {
        day: 1,
        amount: 1,
        kind: 1,
        note: 1,
        byName: 1,
        createdAt: 1,
      },
    ),
  ]);

  const rows: CashEntryRow[] = entries.map((e) => ({
    id: String(e._id),
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
      sales: merge(salesMade, salesVoided),
      payments: merge(paymentsMade, paymentsVoided),
      expenses: merge(expensesMade, expensesVoided),
      purchases,
      returns,
    },
    rows,
  );
}
