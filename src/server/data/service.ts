import type { Db, Document } from "mongodb";
import type { ListParams, Resource } from "@/data/spec";
import { DEFAULT_TIME_ZONE } from "@/lib/constants";
import { lineTotal } from "@/lib/qty";
import { stockStatus } from "@/lib/stock-status";
import type { WireDoc } from "@/schemas/sync";
import { type StoredDoc, toWire } from "../commands/master-data";
import {
  buildFilter,
  decodeCursor,
  encodeCursor,
  filterHash,
  keysetFilter,
  sortKeys,
} from "./query";

/** What a list asks of the server, and what it gets back. */
export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 200;
/** A query that takes longer than this is stopped rather than left to slow the whole database. */
const MAX_TIME_MS = 8_000;

export const COLLECTION: Record<Resource, string> = {
  products: "products",
  customers: "customers",
  suppliers: "suppliers",
  sales: "sales",
  purchases: "purchases",
  expenses: "expenses",
  payments: "payments",
  returns: "returns",
  stockMovements: "stockMovements",
};

export interface Viewer {
  storeId: string;
  /** May this person see what the shop paid for things (purchase prices, costs of sold goods)? */
  canSeeCost: boolean;
  timeZone?: string;
}

export async function storeTimeZone(db: Db, storeId: string): Promise<string> {
  const store = await db
    .collection<{ _id: string; timeZone?: string }>("stores")
    .findOne({ _id: storeId }, { projection: { timeZone: 1 } });
  return store?.timeZone ?? DEFAULT_TIME_ZONE;
}

/**
 * A record as a person may see it: no internal fields, and no cost prices unless they are allowed.
 * `withLines` keeps a sale's or purchase's lines (lists leave them out; their count is on the record).
 */
export function shape(
  resource: Resource,
  doc: Document,
  viewer: Viewer,
  withLines = false,
): WireDoc {
  const wire = toWire(doc as StoredDoc) as unknown as Record<string, unknown>;
  if (!viewer.canSeeCost) {
    if (resource === "products") delete wire.purchasePrice;
    if (Array.isArray(wire.items))
      wire.items = (wire.items as Array<Record<string, unknown>>).map(
        ({ unitCost: _unitCost, ...item }) => item,
      );
  }
  if (!withLines && (resource === "sales" || resource === "purchases"))
    delete wire.items;
  return wire as unknown as WireDoc;
}

export interface Page {
  items: WireDoc[];
  /** Pass this back to get the next page; null when there is no more. */
  nextCursor: string | null;
}

export class BadCursorError extends Error {
  constructor() {
    super("BAD_CURSOR");
  }
}

/** One page of a list, in the order of `src/data/spec.ts`. */
export async function listResource<R extends Resource>(
  db: Db,
  resource: R,
  params: ListParams<R>,
  viewer: Viewer,
  page: { limit?: number; cursor?: string | null } = {},
): Promise<Page> {
  const timeZone = viewer.timeZone ?? (await storeTimeZone(db, viewer.storeId));
  const limit = Math.min(Math.max(page.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const collection = db.collection(COLLECTION[resource]);
  const keys = sortKeys(resource, params as ListParams<Resource>);
  const hash = filterHash(resource, params);

  let filter = buildFilter(resource, params as ListParams<Resource>, {
    storeId: viewer.storeId,
    timeZone,
  });

  // A scanned barcode or SKU goes to the top, once, on the first page.
  let exact: Document[] = [];
  const q = String((params as { q?: string }).q ?? "").trim();
  if (resource === "products" && q && !page.cursor) {
    exact = await collection
      .find({
        storeId: viewer.storeId,
        deletedAt: null,
        $or: [{ barcode: q }, { sku: q }],
      })
      .sort({ _id: 1 })
      .maxTimeMS(MAX_TIME_MS)
      .toArray();
    if (exact.length > 0)
      filter = { $and: [filter, { _id: { $nin: exact.map((d) => d._id) } }] };
  } else if (resource === "products" && q && page.cursor) {
    // Later pages must not show the exact matches again.
    const again = await collection
      .find({
        storeId: viewer.storeId,
        deletedAt: null,
        $or: [{ barcode: q }, { sku: q }],
      })
      .project({ _id: 1 })
      .maxTimeMS(MAX_TIME_MS)
      .toArray();
    if (again.length > 0)
      filter = { $and: [filter, { _id: { $nin: again.map((d) => d._id) } }] };
  }

  if (page.cursor) {
    const values = decodeCursor(page.cursor, hash);
    if (!values || values.length !== keys.length) throw new BadCursorError();
    filter = { $and: [filter, keysetFilter(keys, values)] };
  }

  const found = await collection
    .find(filter)
    .sort(Object.fromEntries(keys.map((k) => [k.field, k.dir])))
    .limit(limit + 1)
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  const hasMore = found.length > limit;
  const rows = found.slice(0, limit);
  const last = rows[rows.length - 1];

  const items = [...exact, ...rows].map((d) => shape(resource, d, viewer));
  if (resource === "stockMovements") await addProductNames(db, viewer, items);

  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor(
            hash,
            keys.map((k) => last[k.field]),
          )
        : null,
  };
}

/** A stock movement list shows which product each row is about: add the names to a page. */
async function addProductNames(db: Db, viewer: Viewer, items: WireDoc[]) {
  const ids = [
    ...new Set(
      items.map((i) => String((i as { productId?: string }).productId)),
    ),
  ];
  const products = await db
    .collection<{ _id: string; name?: string; nameBn?: string }>("products")
    .find(
      { _id: { $in: ids }, storeId: viewer.storeId },
      { projection: { name: 1, nameBn: 1 } },
    )
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  const byId = new Map(products.map((p) => [p._id, p]));
  for (const item of items as Array<Record<string, unknown>>) {
    const p = byId.get(String(item.productId));
    item.productName = p?.name ?? "";
    item.productNameBn = p?.nameBn ?? "";
  }
}

/** Whole-list numbers for the header (counts and sums over everything that matches, not one page). */
export async function totalsOf<R extends Resource>(
  db: Db,
  resource: R,
  params: ListParams<R>,
  viewer: Viewer,
): Promise<Record<string, number>> {
  const timeZone = viewer.timeZone ?? (await storeTimeZone(db, viewer.storeId));
  const filter = buildFilter(resource, params as ListParams<Resource>, {
    storeId: viewer.storeId,
    timeZone,
  });
  const active = (field: string) => ({
    $sum: { $cond: [{ $eq: ["$status", "active"] }, `$${field}`, 0] },
  });
  const groups: Partial<Record<Resource, Document>> = {
    sales: { sold: active("total"), due: active("due"), paid: active("paid") },
    purchases: { total: { $sum: "$total" }, due: { $sum: "$due" } },
    customers: {
      owed: { $sum: { $cond: [{ $gt: ["$balance", 0] }, "$balance", 0] } },
      advance: {
        $sum: {
          $cond: [{ $lt: ["$balance", 0] }, { $multiply: ["$balance", -1] }, 0],
        },
      },
    },
    suppliers: {
      owed: { $sum: { $cond: [{ $gt: ["$balance", 0] }, "$balance", 0] } },
      advance: {
        $sum: {
          $cond: [{ $lt: ["$balance", 0] }, { $multiply: ["$balance", -1] }, 0],
        },
      },
    },
    expenses: { amount: active("amount") },
    payments: { amount: { $sum: "$amount" } },
    returns: { total: { $sum: "$total" } },
  };
  const [row] = await db
    .collection(COLLECTION[resource])
    .aggregate(
      [
        { $match: filter },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            ...(groups[resource] ?? {}),
          },
        },
      ],
      { maxTimeMS: MAX_TIME_MS },
    )
    .toArray();
  const { _id: _ignored, ...totals } = row ?? { count: 0 };
  const result: Record<string, number> = { count: 0 };
  for (const [key, value] of Object.entries(totals))
    result[key] = Number(value);
  if (!viewer.canSeeCost) delete result.cost;
  return result;
}

/** Everything a record's own screen needs: a sale with its lines and returns, a person with their statement, ... */
export async function getRecord(
  db: Db,
  resource: Resource,
  id: string,
  viewer: Viewer,
): Promise<{ record: WireDoc; extra: Record<string, WireDoc[]> } | null> {
  const doc = await db
    .collection(COLLECTION[resource])
    .findOne({ _id: id as never, storeId: viewer.storeId });
  if (!doc) return null;
  const record = shape(resource, doc, viewer, true);
  const extra: Record<string, WireDoc[]> = {};
  const rows = (
    name: string,
    filter: Document,
    sort: Document,
    limit: number,
  ) =>
    db
      .collection(name)
      .find({ storeId: viewer.storeId, ...filter })
      .sort(sort)
      .limit(limit)
      .maxTimeMS(MAX_TIME_MS)
      .toArray();

  if (resource === "sales" || resource === "purchases") {
    const kind = resource === "sales" ? "sale" : "purchase";
    extra.returns = (
      await rows("returns", { kind, refId: id }, { createdAt: 1 }, 100)
    ).map((d) => shape("returns", d, viewer));
  } else if (resource === "products") {
    extra.stockMovements = (
      await rows(
        "stockMovements",
        { productId: id },
        { createdAt: -1, _id: 1 },
        100,
      )
    ).map((d) => shape("stockMovements", d, viewer));
  } else if (resource === "customers" || resource === "suppliers") {
    extra.ledgerEntries = (
      await rows(
        "ledgerEntries",
        { partyId: id },
        { createdAt: -1, _id: 1 },
        200,
      )
    ).map((d) => toWire(d as unknown as StoredDoc));
  }
  return { record, extra };
}

/** A scanned or typed barcode or SKU: the one active product it belongs to. */
export async function lookupProduct(
  db: Db,
  code: string,
  viewer: Viewer,
): Promise<WireDoc | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const products = db.collection("products");
  const base = {
    storeId: viewer.storeId,
    deletedAt: null,
    isActive: { $ne: false },
  };
  const doc =
    (await products.findOne({ ...base, barcode: trimmed })) ??
    (await products.findOne({ ...base, sku: trimmed }));
  return doc ? shape("products", doc, viewer) : null;
}

/**
 * What the stock is worth and how much is running low, over the whole catalogue (the stock report's
 * header). Worked out with the same rounding as the device, so both agree to the poisha.
 */
export async function stockSummary(
  db: Db,
  viewer: Viewer,
): Promise<{
  costValue: number;
  retailValue: number;
  lowCount: number;
  outCount: number;
}> {
  const summary = { costValue: 0, retailValue: 0, lowCount: 0, outCount: 0 };
  const cursor = db
    .collection("products")
    .find(
      { storeId: viewer.storeId, deletedAt: null, isActive: { $ne: false } },
      {
        projection: {
          stock: 1,
          purchasePrice: 1,
          sellingPrice: 1,
          lowStockThreshold: 1,
        },
      },
    )
    .maxTimeMS(MAX_TIME_MS * 2);
  for await (const p of cursor) {
    const stock = Number(p.stock ?? 0);
    if (viewer.canSeeCost)
      summary.costValue += Math.max(
        0,
        lineTotal(Number(p.purchasePrice ?? 0), stock),
      );
    summary.retailValue += Math.max(
      0,
      lineTotal(Number(p.sellingPrice ?? 0), stock),
    );
    const status = stockStatus({
      stock,
      lowStockThreshold: Number(p.lowStockThreshold ?? 0),
    });
    if (status === "low") summary.lowCount++;
    if (status === "out") summary.outCount++;
  }
  return summary;
}
