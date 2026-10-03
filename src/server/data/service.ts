import type { Db, Document } from "mongodb";
import type { ListParams, Resource } from "@/data/spec";
import { DEFAULT_TIME_ZONE } from "@/lib/constants";
import { queryTokens } from "@/lib/search-fields";
import type { WireChange, WireDoc } from "@/schemas/sync";
import { caches } from "../cache";
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
  const cached = caches.timeZones.get(storeId);
  if (cached !== undefined) return cached;
  const store = await db
    .collection<{ _id: string; timeZone?: string }>("stores")
    .findOne({ _id: storeId }, { projection: { timeZone: 1 } });
  const timeZone = store?.timeZone ?? DEFAULT_TIME_ZONE;
  caches.timeZones.set(storeId, timeZone);
  return timeZone;
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
/** The biggest low-stock threshold in the shop (one index lookup). Nothing above it can be low. */
async function lowStockBound(db: Db, storeId: string): Promise<number> {
  const top = await db
    .collection("products")
    .find({ storeId }, { projection: { lowStockThreshold: 1 } })
    .sort({ lowStockThreshold: -1 })
    .limit(1)
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  return Math.max(0, Number(top[0]?.lowStockThreshold ?? 0));
}

const SEARCH_INDEX = { storeId: 1, searchWords: 1 } as const;

/**
 * A sales or purchases search with a number in it (an invoice number, a phone) matches very few
 * records, so it should start from the search-word index. Left to itself MongoDB also tries
 * walking the records by date and filtering, and that trial alone costs hundreds of milliseconds
 * on a big shop. (Products, customers and suppliers are better off letting it choose: their
 * names and codes have their own indexes, and a hint made barcode and "rice 4321" searches 10
 * times slower.)
 */
const searchHint = (resource: Resource, params: unknown) => {
  const q = String((params as { q?: string }).q ?? "");
  return (resource === "sales" || resource === "purchases") &&
    queryTokens(q).some((t) => /[0-9]/.test(t))
    ? SEARCH_INDEX
    : undefined;
};

/** Only a "low stock" question needs the bound. */
const boundFor = (
  db: Db,
  resource: Resource,
  params: unknown,
  storeId: string,
): Promise<number | undefined> =>
  resource === "products" && (params as { stock?: string }).stock === "low"
    ? lowStockBound(db, storeId)
    : Promise.resolve(undefined);

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
    lowStockBound: await boundFor(db, resource, params, viewer.storeId),
  });

  // A scanned barcode or SKU goes to the top, once, on the first page. It is asked at the same
  // time as the page itself, and taken out of the page afterwards (it appears in it too).
  const q = String((params as { q?: string }).q ?? "").trim();
  const exactQuery =
    resource === "products" && q
      ? collection
          .find({
            storeId: viewer.storeId,
            deletedAt: null,
            $or: [{ barcode: q }, { sku: q }],
          })
          .sort({ _id: 1 })
          .maxTimeMS(MAX_TIME_MS)
          .toArray()
      : Promise.resolve([] as Document[]);

  if (page.cursor) {
    const values = decodeCursor(page.cursor, hash);
    if (!values || values.length !== keys.length) throw new BadCursorError();
    filter = { $and: [filter, keysetFilter(keys, values)] };
  }

  const hint = searchHint(resource, params);
  const [exact, found] = await Promise.all([
    exactQuery,
    collection
      .find(filter, hint ? { hint } : {})
      .sort(Object.fromEntries(keys.map((k) => [k.field, k.dir])))
      .limit(limit + 1)
      .maxTimeMS(MAX_TIME_MS)
      .toArray(),
  ]);
  const hasMore = found.length > limit;
  const rows = found.slice(0, limit);
  const last = rows[rows.length - 1];

  const exactIds = new Set(exact.map((d) => String(d._id)));
  const shown = rows.filter((d) => !exactIds.has(String(d._id)));
  const items = [...(page.cursor ? [] : exact), ...shown].map((d) =>
    shape(resource, d, viewer),
  );
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
    lowStockBound: await boundFor(db, resource, params, viewer.storeId),
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
      (() => {
        const hint = searchHint(resource, params);
        return hint
          ? { maxTimeMS: MAX_TIME_MS, hint }
          : { maxTimeMS: MAX_TIME_MS };
      })(),
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
  // The record and what belongs to it are asked at the same time (the related rows only need the
  // id, and they are scoped to the shop like everything else).
  const docPromise = db
    .collection(COLLECTION[resource])
    .findOne({ _id: id as never, storeId: viewer.storeId });
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

  const extraPromise: Promise<Record<string, WireDoc[]>> =
    resource === "sales" || resource === "purchases"
      ? rows(
          "returns",
          { kind: resource === "sales" ? "sale" : "purchase", refId: id },
          { createdAt: 1 },
          100,
        ).then((found) => ({
          returns: found.map((d) => shape("returns", d, viewer)),
        }))
      : resource === "products"
        ? rows(
            "stockMovements",
            { productId: id },
            { createdAt: -1, _id: 1 },
            100,
          ).then((found) => ({
            stockMovements: found.map((d) =>
              shape("stockMovements", d, viewer),
            ),
          }))
        : resource === "customers" || resource === "suppliers"
          ? rows(
              "ledgerEntries",
              { partyId: id },
              { createdAt: -1, _id: 1 },
              200,
            ).then((found) => ({
              ledgerEntries: found.map((d) =>
                toWire(d as unknown as StoredDoc),
              ),
            }))
          : Promise.resolve({});
  const [doc, extra] = await Promise.all([docPromise, extraPromise]);
  if (!doc) return null;
  return { record: shape(resource, doc, viewer, true), extra };
}

/**
 * The records a command changed, as a person may see them: no purchase prices and no cost of sold
 * goods unless they are allowed (the same rule `shape()` applies to every list and record). A save
 * returns the records it changed, so without this a cashier's browser would receive costs.
 */
export function hideCostInChanges(
  changes: WireChange[],
  viewer: Pick<Viewer, "canSeeCost">,
): WireChange[] {
  if (viewer.canSeeCost) return changes;
  return changes.map((change) => {
    const doc = { ...(change.doc as unknown as Record<string, unknown>) };
    if (change.collection === "products") delete doc.purchasePrice;
    if (Array.isArray(doc.items))
      doc.items = (doc.items as Array<Record<string, unknown>>).map(
        ({ unitCost: _unitCost, ...item }) => item,
      );
    return { ...change, doc: doc as never };
  });
}

/** How far the shop's changes have got, according to a set of records (the highest sequence in them). */
export function headOf(changes: WireChange[]): number {
  let head = 0;
  for (const c of changes) {
    const seq = Number((c.doc as unknown as { syncSeq?: number }).syncSeq ?? 0);
    if (seq > head) head = seq;
  }
  return head;
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
  // One question for both; a barcode match wins over a SKU match (as it always did).
  const found = await products
    .find({ ...base, $or: [{ barcode: trimmed }, { sku: trimmed }] })
    .limit(2)
    .maxTimeMS(MAX_TIME_MS)
    .toArray();
  const doc = found.find((d) => d.barcode === trimmed) ?? found[0];
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
  // Added up inside the database (one pass, nothing sent to the server process). The rounding
  // matches lineTotal(): half a poisha rounds up, and a negative stock is worth nothing.
  const worth = (price: string) => ({
    $max: [
      0,
      {
        $floor: {
          $add: [
            {
              $divide: [
                {
                  $multiply: [
                    { $ifNull: [price, 0] },
                    { $ifNull: ["$stock", 0] },
                  ],
                },
                1000,
              ],
            },
            0.5,
          ],
        },
      },
    ],
  });
  const [row] = await db
    .collection("products")
    .aggregate(
      [
        {
          $match: {
            storeId: viewer.storeId,
            deletedAt: null,
            isActive: { $ne: false },
          },
        },
        {
          $group: {
            _id: null,
            costValue: {
              $sum: viewer.canSeeCost ? worth("$purchasePrice") : 0,
            },
            retailValue: { $sum: worth("$sellingPrice") },
            outCount: {
              $sum: {
                $cond: [{ $lte: [{ $ifNull: ["$stock", 0] }, 0] }, 1, 0],
              },
            },
            lowCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gt: [{ $ifNull: ["$stock", 0] }, 0] },
                      { $gt: [{ $ifNull: ["$lowStockThreshold", 0] }, 0] },
                      {
                        $lte: [
                          { $ifNull: ["$stock", 0] },
                          { $ifNull: ["$lowStockThreshold", 0] },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ],
      { maxTimeMS: MAX_TIME_MS * 2 },
    )
    .toArray();
  return {
    costValue: Number(row?.costValue ?? 0),
    retailValue: Number(row?.retailValue ?? 0),
    lowCount: Number(row?.lowCount ?? 0),
    outCount: Number(row?.outCount ?? 0),
  };
}
