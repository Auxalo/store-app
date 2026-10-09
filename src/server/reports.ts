import type { Db } from "mongodb";
import type { Expense, Purchase, ReturnDoc } from "@/db/local/types";
import {
  type DayRange,
  rangeBounds,
  type SaleWithItems,
  type Summary,
  summarize,
} from "@/reports/compute";

const strip = <T extends { _id?: unknown }>(
  doc: T,
): Omit<T, "_id"> & { id: string } => {
  const { _id, ...rest } = doc;
  return { ...rest, id: String(_id) } as never;
};

/** A report for someone who may see sales but not what the goods cost (so not profit either). */
export function hideProfit(summary: Summary): Summary {
  return {
    ...summary,
    cost: 0,
    profit: 0,
    netProfit: 0,
    byProduct: summary.byProduct.map((p) => ({ ...p, profit: 0 })),
    byCategory: summary.byCategory.map((c) => ({ ...c, profit: 0 })),
    byDay: summary.byDay.map((d) => ({ ...d, profit: 0 })),
  };
}

const cache = new Map<string, { head: number; summary: Summary }>();
const CACHE_ENTRIES = 60;

/**
 * The report for a range, kept in memory until anything changes in the shop (the shop's change
 * counter moves with every saved change). Opening the same report again, from another device or
 * after a reload, costs one tiny read instead of going through every sale again.
 */
export async function serverSummaryCached(
  db: Db,
  storeId: string,
  range: DayRange,
  timeZone?: string,
): Promise<Summary> {
  const store = await db
    .collection<{ _id: string; syncSeq?: number }>("stores")
    .findOne({ _id: storeId }, { projection: { syncSeq: 1 } });
  const head = store?.syncSeq ?? 0;
  const key = `${storeId}|${range.from}|${range.to}|${timeZone ?? ""}`;
  const hit = cache.get(key);
  if (hit && hit.head === head) return hit.summary;
  const summary = await serverSummary(db, storeId, range, timeZone);
  cache.delete(key);
  cache.set(key, { head, summary });
  if (cache.size > CACHE_ENTRIES)
    cache.delete(cache.keys().next().value as string);
  return summary;
}

/**
 * The same report the device computes, from the server's copy of the data. Used for ranges older
 * than what a device keeps, and as the check that device and server agree.
 */
export async function serverSummary(
  db: Db,
  storeId: string,
  range: DayRange,
  timeZone?: string,
): Promise<Summary> {
  const { start, end } = rangeBounds(range, timeZone);
  const created = { storeId, createdAt: { $gte: start, $lt: end } };
  const [sales, returns, expenses, purchases] = await Promise.all([
    // Only what the report reads (not the buyer, notes, search words, line ids ...): a month of a
    // busy shop is tens of thousands of sales with their lines, and sending less of each is faster.
    db
      .collection("sales")
      .find(created, {
        projection: {
          status: 1,
          deletedAt: 1,
          createdAt: 1,
          subtotal: 1,
          discount: 1,
          total: 1,
          paid: 1,
          due: 1,
          creditUsed: 1,
          paymentMethod: 1,
          "items.productId": 1,
          "items.productName": 1,
          "items.productNameBn": 1,
          "items.unit": 1,
          "items.qty": 1,
          "items.unitCost": 1,
          "items.lineTotal": 1,
        },
      })
      .toArray(),
    db.collection("returns").find(created).toArray(),
    db
      .collection("expenses")
      .find({ storeId, date: { $gte: range.from, $lte: range.to } })
      .toArray(),
    db
      .collection("purchases")
      .find({ storeId, date: { $gte: range.from, $lte: range.to } })
      .toArray(),
  ]);

  const known = new Map<string, SaleWithItems>(
    sales.map((s) => [String(s._id), strip(s) as unknown as SaleWithItems]),
  );
  const missing = [
    ...new Set(
      returns.filter((r) => r.kind === "sale").map((r) => String(r.refId)),
    ),
  ].filter((id) => !known.has(id));
  if (missing.length > 0) {
    for (const s of await db
      .collection("sales")
      .find({ storeId, _id: { $in: missing as never[] } })
      .toArray())
      known.set(String(s._id), strip(s) as unknown as SaleWithItems);
  }

  const productIds = new Set<string>();
  for (const sale of known.values())
    for (const item of sale.items ?? []) productIds.add(item.productId);
  const products = await db
    .collection("products")
    .find({ storeId, _id: { $in: [...productIds] as never[] } })
    .project({ categoryId: 1 })
    .toArray();
  const category = new Map(
    products.map((p) => [
      String(p._id),
      (p.categoryId as string | null) ?? null,
    ]),
  );

  return summarize({
    range,
    timeZone,
    sales: sales.map((s) => known.get(String(s._id)) as SaleWithItems),
    returns: returns.map((r) => strip(r) as unknown as ReturnDoc),
    expenses: expenses.map((e) => strip(e) as unknown as Expense),
    purchases: purchases.map((p) => strip(p) as unknown as Purchase),
    findSale: (id) => known.get(id),
    categoryOf: (id) => category.get(id) ?? null,
  });
}
