import type { Db } from "mongodb";
import {
  buildCash,
  type CashEntryRow,
  type CashExpense,
  type CashInputs,
  type CashPayment,
  type CashPurchase,
  type CashReport,
  type CashReturn,
  type CashSale,
  type MoneyFlow,
  moneyFlow,
  returnsWithMethod,
} from "@/reports/cash";
import { type DayRange, rangeBounds } from "@/reports/compute";

const HISTORY_DAYS = 14;
const MAX_TIME_MS = 8_000;

const addDays = (day: string, delta: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};

/** What moved money in the days of `range` (made in them, or cancelled in them), from the server's copy. */
export async function serverFlowInputs(
  db: Db,
  storeId: string,
  range: DayRange,
  timeZone: string,
): Promise<CashInputs> {
  const { start, end } = rangeBounds(range, timeZone);
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
    find<CashReturn & { refId: string }>("returns", made, {
      kind: 1,
      refId: 1,
      total: 1,
      cashBack: 1,
      credited: 1,
      settlement: 1,
      createdAt: 1,
    }),
  ]);

  // A refund moves money the way its bill was paid, so look the bills up.
  const methodsOf = async (collection: string, kind: "sale" | "purchase") => {
    const ids = [
      ...new Set(returns.filter((r) => r.kind === kind).map((r) => r.refId)),
    ];
    if (ids.length === 0) return new Map<string, string>();
    const bills = await find<{ paymentMethod?: string }>(
      collection,
      { storeId, _id: { $in: ids } },
      { paymentMethod: 1 },
    );
    return new Map(
      bills.map((b) => [String(b._id), String(b.paymentMethod ?? "cash")]),
    );
  };
  const [saleMethods, purchaseMethods] = await Promise.all([
    methodsOf("sales", "sale"),
    methodsOf("purchases", "purchase"),
  ]);

  return {
    sales: merge(salesMade, salesVoided),
    payments: merge(paymentsMade, paymentsVoided),
    expenses: merge(expensesMade, expensesVoided),
    purchases,
    returns: returnsWithMethod(returns, saleMethods, purchaseMethods),
  };
}

/** The cash drawer's day, from the server's copy of the shop (same rules as the device: src/reports/cash.ts). */
export async function serverCash(
  db: Db,
  storeId: string,
  day: string,
  timeZone: string,
): Promise<CashReport> {
  const [inputs, entries] = await Promise.all([
    serverFlowInputs(db, storeId, { from: day, to: day }, timeZone),
    db
      .collection("cashDrawer")
      .find(
        { storeId, day: { $gte: addDays(day, -HISTORY_DAYS), $lte: day } },
        {
          projection: {
            day: 1,
            amount: 1,
            kind: 1,
            note: 1,
            byName: 1,
            createdAt: 1,
          },
        },
      )
      .maxTimeMS(MAX_TIME_MS)
      .toArray() as unknown as Promise<
      Array<Omit<CashEntryRow, "id"> & { _id: string }>
    >,
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
  return buildCash(day, timeZone, inputs, rows);
}

/** Money in and out for the days of `range`, by payment method, from the server's copy. */
export async function serverMoney(
  db: Db,
  storeId: string,
  range: DayRange,
  timeZone: string,
): Promise<MoneyFlow> {
  return moneyFlow(
    range,
    timeZone,
    await serverFlowInputs(db, storeId, range, timeZone),
  );
}

const cache = new Map<string, { head: number; flow: MoneyFlow }>();
const CACHE_ENTRIES = 40;

/**
 * Money in and out for a range, kept in memory until anything changes in the shop (the shop's
 * change counter moves with every saved change), like the sales report.
 */
export async function serverMoneyCached(
  db: Db,
  storeId: string,
  range: DayRange,
  timeZone: string,
): Promise<MoneyFlow> {
  const store = await db
    .collection<{ _id: string; syncSeq?: number }>("stores")
    .findOne({ _id: storeId }, { projection: { syncSeq: 1 } });
  const head = store?.syncSeq ?? 0;
  const key = `${storeId}|${range.from}|${range.to}|${timeZone}`;
  const hit = cache.get(key);
  if (hit && hit.head === head) return hit.flow;
  const flow = await serverMoney(db, storeId, range, timeZone);
  cache.delete(key);
  cache.set(key, { head, flow });
  if (cache.size > CACHE_ENTRIES)
    cache.delete(cache.keys().next().value as string);
  return flow;
}
