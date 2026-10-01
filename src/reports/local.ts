import type { StoreDB } from "@/db/local/db";
import { stockStatus } from "@/db/local/queries/products";
import type { Product, Sale, SaleItem } from "@/db/local/types";
import { DEFAULT_TIME_ZONE } from "@/lib/constants";
import {
  type DayRange,
  rangeBounds,
  type SaleWithItems,
  type StockRow,
  type Summary,
  stockRows,
  summarize,
} from "./compute";

async function withItems(db: StoreDB, sales: Sale[]): Promise<SaleWithItems[]> {
  if (sales.length === 0) return [];
  const items = await db.saleItems
    .where("saleId")
    .anyOf(sales.map((s) => s.id))
    .toArray();
  const bySale = new Map<string, SaleItem[]>();
  for (const item of items) {
    const list = bySale.get(item.saleId) ?? [];
    list.push(item);
    bySale.set(item.saleId, list);
  }
  return sales.map((sale) => ({
    ...sale,
    // Lines are stored as `<saleId>:i<index>`: put them back in sale order.
    items: (bySale.get(sale.id) ?? []).sort(
      (a, b) => lineIndex(a) - lineIndex(b),
    ),
  }));
}

const lineIndex = (item: SaleItem) =>
  Number(item.id.slice(item.id.lastIndexOf(":i") + 2));

/** Sales, returns, expenses and purchases for the range, all read from this device. */
export async function loadSummary(
  db: StoreDB,
  range: DayRange,
  timeZone = DEFAULT_TIME_ZONE,
): Promise<Summary> {
  const { start, end } = rangeBounds(range, timeZone);
  const [sales, returns, expenses, purchases] = await Promise.all([
    db.sales.where("createdAt").between(start, end, true, false).toArray(),
    db.returns.where("createdAt").between(start, end, true, false).toArray(),
    db.expenses
      .where("date")
      .between(range.from, range.to, true, true)
      .toArray(),
    db.purchases
      .where("date")
      .between(range.from, range.to, true, true)
      .toArray(),
  ]);

  const inRange = await withItems(db, sales);
  const known = new Map(inRange.map((s) => [s.id, s]));
  const missing = [
    ...new Set(returns.filter((r) => r.kind === "sale").map((r) => r.refId)),
  ].filter((id) => !known.has(id));
  if (missing.length > 0) {
    const older = (await db.sales.bulkGet(missing)).filter(
      (s): s is Sale => !!s,
    );
    for (const sale of await withItems(db, older)) known.set(sale.id, sale);
  }

  const productIds = new Set<string>();
  for (const sale of known.values())
    for (const item of sale.items) productIds.add(item.productId);
  const products = (await db.products.bulkGet([...productIds])).filter(
    (p): p is Product => !!p,
  );
  const category = new Map(products.map((p) => [p.id, p.categoryId]));

  return summarize({
    range,
    timeZone,
    sales: inRange,
    returns,
    expenses,
    purchases,
    findSale: (id) => known.get(id),
    categoryOf: (id) => category.get(id) ?? null,
  });
}

export interface Dues {
  customerTotal: number;
  customers: Array<{ id: string; name: string; phone: string; amount: number }>;
  supplierTotal: number;
  suppliers: Array<{ id: string; name: string; phone: string; amount: number }>;
}

/** What customers owe us and what we owe suppliers right now (positive balances only). */
export async function loadDues(db: StoreDB): Promise<Dues> {
  const [customers, suppliers] = await Promise.all([
    db.customers.toArray(),
    db.suppliers.toArray(),
  ]);
  const owed = <
    T extends {
      id: string;
      name: string;
      phone: string;
      balance: number;
      deletedAt?: string | null;
    },
  >(
    rows: T[],
  ) =>
    rows
      .filter((r) => !r.deletedAt && r.balance > 0)
      .map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        amount: r.balance,
      }))
      .sort((a, b) => b.amount - a.amount);
  const c = owed(customers);
  const s = owed(suppliers);
  return {
    customerTotal: c.reduce((sum, r) => sum + r.amount, 0),
    customers: c,
    supplierTotal: s.reduce((sum, r) => sum + r.amount, 0),
    suppliers: s,
  };
}

export interface StockReport {
  rows: StockRow[];
  costValue: number;
  retailValue: number;
  lowCount: number;
  outCount: number;
}

export async function loadStock(db: StoreDB): Promise<StockReport> {
  const rows = stockRows(await db.products.toArray());
  return {
    rows: rows.sort((a, b) => a.name.localeCompare(b.name)),
    costValue: rows.reduce((sum, r) => sum + r.costValue, 0),
    retailValue: rows.reduce((sum, r) => sum + r.retailValue, 0),
    lowCount: rows.filter((r) => stockStatus(r) === "low").length,
    outCount: rows.filter((r) => stockStatus(r) === "out").length,
  };
}
