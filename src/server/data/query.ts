import { createHash } from "node:crypto";
import type { Document } from "mongodb";
import { directionOf, type ListParams, type Resource } from "@/data/spec";
import { queryTokens } from "@/lib/search-fields";
import { rangeBounds } from "@/reports/compute";

/**
 * The server's half of the list rules in `src/data/spec.ts`: the same filters and the same order,
 * written as MongoDB queries. A test runs identical questions through this and through the plain
 * reference, and requires identical answers, so the online and offline modes can never differ.
 */

export interface SortKey {
  field: string;
  dir: 1 | -1;
}

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every typed word must start some word of the record. The first word uses the index. */
function wordsClause(query: string): Document | null {
  const tokens = queryTokens(query).sort((a, b) => b.length - a.length);
  if (tokens.length === 0) return null;
  return {
    searchWords: {
      $all: tokens.map((token) => new RegExp(`^${escapeRegex(token)}`)),
    },
  };
}

/** The UTC range of a run of store days: `from` is its first moment, `to` is where the next day begins. */
function createdAtRange(
  from: string | undefined,
  to: string | undefined,
  timeZone: string,
): Document | null {
  if (!from && !to) return null;
  const range: Document = {};
  if (from) range.$gte = rangeBounds({ from, to: from }, timeZone).start;
  if (to) range.$lt = rangeBounds({ from: to, to }, timeZone).end;
  return { createdAt: range };
}

function dateRange(
  from: string | undefined,
  to: string | undefined,
): Document | null {
  if (!from && !to) return null;
  const range: Document = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return { date: range };
}

/** The Mongo filter for one list. Deleted records never show. */
export function buildFilter(
  resource: Resource,
  params: ListParams<Resource>,
  context: { storeId: string; timeZone: string },
): Document {
  const p = params as Record<string, unknown>;
  const base: Document = { storeId: context.storeId, deletedAt: null };
  const clauses: Array<Document | null> = [];

  switch (resource) {
    case "products": {
      clauses.push(wordsClause(String(p.q ?? "")));
      if (p.active === "active") clauses.push({ isActive: { $ne: false } });
      if (p.active === "inactive") clauses.push({ isActive: false });
      if (p.categoryId === "none") clauses.push({ categoryId: null });
      else if (p.categoryId) clauses.push({ categoryId: p.categoryId });
      if (p.stock === "out") clauses.push({ stock: { $lte: 0 } });
      if (p.stock === "low")
        clauses.push({
          $or: [
            { stock: { $lte: 0 } },
            {
              lowStockThreshold: { $gt: 0 },
              $expr: { $lte: ["$stock", "$lowStockThreshold"] },
            },
          ],
        });
      const others = clauses.filter((c): c is Document => c !== null);
      const q = String(p.q ?? "").trim();
      // An exact barcode or SKU always finds its product, whatever the other filters say.
      if (q)
        return {
          ...base,
          $or: [
            { barcode: q },
            { sku: q },
            others.length ? { $and: others } : {},
          ],
        };
      return others.length ? { ...base, $and: others } : base;
    }
    case "customers":
    case "suppliers":
      clauses.push(wordsClause(String(p.q ?? "")));
      if (p.balance === "owes") clauses.push({ balance: { $gt: 0 } });
      if (p.balance === "advance") clauses.push({ balance: { $lt: 0 } });
      break;
    case "sales":
      clauses.push(wordsClause(String(p.q ?? "")));
      clauses.push(
        createdAtRange(p.from as string, p.to as string, context.timeZone),
      );
      if (p.status !== "all") clauses.push({ status: p.status });
      if (p.method) clauses.push({ paymentMethod: p.method });
      if (p.dueOnly) clauses.push({ due: { $gt: 0 } });
      if (p.customerId) clauses.push({ customerId: p.customerId });
      break;
    case "purchases":
      clauses.push(wordsClause(String(p.q ?? "")));
      clauses.push(dateRange(p.from as string, p.to as string));
      if (p.supplierId) clauses.push({ supplierId: p.supplierId });
      if (p.dueOnly) clauses.push({ due: { $gt: 0 } });
      break;
    case "expenses":
      clauses.push(dateRange(p.from as string, p.to as string));
      if (p.category) clauses.push({ category: p.category });
      if (p.method) clauses.push({ method: p.method });
      if (p.status !== "all") clauses.push({ status: p.status });
      break;
    case "payments":
      if (p.type !== "all") clauses.push({ partyType: p.type });
      clauses.push(
        createdAtRange(p.from as string, p.to as string, context.timeZone),
      );
      if (p.partyId) clauses.push({ partyId: p.partyId });
      break;
    case "returns":
      if (p.kind !== "all") clauses.push({ kind: p.kind });
      clauses.push(
        createdAtRange(p.from as string, p.to as string, context.timeZone),
      );
      break;
    case "stockMovements":
      if (p.productId) clauses.push({ productId: p.productId });
      if (p.type) clauses.push({ type: p.type });
      clauses.push(
        createdAtRange(p.from as string, p.to as string, context.timeZone),
      );
      break;
  }
  const real = clauses.filter((c): c is Document => c !== null);
  return real.length ? { ...base, $and: real } : base;
}

const SORT_FIELD: Record<string, string> = {
  name: "nameKey",
  stock: "stock",
  price: "sellingPrice",
  balance: "balance",
  total: "total",
  due: "due",
  amount: "amount",
};

/** The order of one list as Mongo sort keys. The id always breaks ties, ascending. */
export function sortKeys(
  resource: Resource,
  params: ListParams<Resource>,
): SortKey[] {
  const { sort, dir } = params as { sort: string; dir?: "asc" | "desc" };
  const d: 1 | -1 = directionOf(sort, dir) === "asc" ? 1 : -1;
  const fields = SORT_FIELD[sort]
    ? [SORT_FIELD[sort]]
    : resource === "expenses" || resource === "purchases"
      ? ["date", "createdAt"]
      : ["createdAt"];
  return [
    ...fields.map((field): SortKey => ({ field, dir: d })),
    { field: "_id", dir: 1 },
  ];
}

/** A page boundary: the values of the last record shown, for every sort key. */
interface CursorPayload {
  /** Which question this belongs to; a cursor for a different search or filter is refused. */
  h: string;
  v: unknown[];
}

export const filterHash = (resource: Resource, params: unknown) =>
  createHash("sha1")
    .update(JSON.stringify({ resource, params }))
    .digest("hex")
    .slice(0, 12);

export function encodeCursor(hash: string, values: unknown[]): string {
  return Buffer.from(
    JSON.stringify({ h: hash, v: values } satisfies CursorPayload),
  ).toString("base64url");
}

export function decodeCursor(cursor: string, hash: string): unknown[] | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as CursorPayload;
    return parsed.h === hash && Array.isArray(parsed.v) ? parsed.v : null;
  } catch {
    return null;
  }
}

/** "After this record, in this order": a page that never repeats or skips a record. */
export function keysetFilter(keys: SortKey[], values: unknown[]): Document {
  return {
    $or: keys.map((key, i) => ({
      ...Object.fromEntries(
        keys.slice(0, i).map((k, j) => [k.field, values[j]]),
      ),
      [key.field]: { [key.dir === 1 ? "$gt" : "$lt"]: values[i] },
    })),
  };
}
