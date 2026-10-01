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
    db.collection("sales").find(created).toArray(),
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
