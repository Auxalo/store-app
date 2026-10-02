import { z } from "zod";
import { DEFAULT_TIME_ZONE } from "@/lib/constants";
import { normalizeSearch } from "@/lib/search";
import { derivedSearchFields, queryTokens } from "@/lib/search-fields";
import { stockStatus } from "@/lib/stock-status";
import { dayKey } from "@/reports/compute";
import { EXPENSE_CATEGORIES } from "@/schemas/expense";
import { PAYMENT_METHODS } from "@/schemas/sale";

/**
 * How every list in the app is searched, filtered and sorted, written ONCE.
 *
 * Two things implement these rules: the device (IndexedDB, for offline mode) and the server
 * (MongoDB, for online mode). The functions here are the plain-language reference: a test feeds the
 * same records and the same questions to all three and requires the same answers in the same order,
 * so the two modes can never drift apart.
 */

export const RESOURCES = [
  "products",
  "customers",
  "suppliers",
  "sales",
  "purchases",
  "expenses",
  "payments",
  "returns",
  "stockMovements",
] as const;
export type Resource = (typeof RESOURCES)[number];

const text = z.string().trim().default("");
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();
const id = z.string().min(1).max(64).optional();
const dir = z.enum(["asc", "desc"]).optional();
const MONEY_STATUS = z.enum(["all", "active", "voided"]);

export const listParamsSchemas = {
  products: z.object({
    q: text,
    /** A category id, or "none" for products with no category. */
    categoryId: z.string().min(1).max(64).optional(),
    stock: z.enum(["all", "low", "out"]).default("all"),
    active: z.enum(["active", "inactive", "all"]).default("active"),
    sort: z.enum(["name", "stock", "price", "newest"]).default("name"),
    dir,
  }),
  customers: z.object({
    q: text,
    balance: z.enum(["all", "owes", "advance"]).default("all"),
    sort: z.enum(["name", "balance", "newest"]).default("name"),
    dir,
  }),
  suppliers: z.object({
    q: text,
    balance: z.enum(["all", "owes", "advance"]).default("all"),
    sort: z.enum(["name", "balance", "newest"]).default("name"),
    dir,
  }),
  sales: z.object({
    q: text,
    from: day,
    to: day,
    status: MONEY_STATUS.default("all"),
    method: z.enum(PAYMENT_METHODS).optional(),
    dueOnly: z.boolean().default(false),
    customerId: id,
    sort: z.enum(["newest", "oldest", "total", "due"]).default("newest"),
    dir,
  }),
  purchases: z.object({
    q: text,
    from: day,
    to: day,
    supplierId: id,
    dueOnly: z.boolean().default(false),
    sort: z.enum(["newest", "oldest", "total", "due"]).default("newest"),
    dir,
  }),
  expenses: z.object({
    from: day,
    to: day,
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    status: MONEY_STATUS.default("active"),
    sort: z.enum(["newest", "oldest", "amount"]).default("newest"),
    dir,
  }),
  payments: z.object({
    type: z.enum(["all", "customer", "supplier"]).default("all"),
    from: day,
    to: day,
    partyId: id,
    sort: z.enum(["newest", "oldest", "amount"]).default("newest"),
    dir,
  }),
  returns: z.object({
    kind: z.enum(["all", "sale", "purchase"]).default("all"),
    from: day,
    to: day,
    sort: z.enum(["newest", "oldest", "total"]).default("newest"),
    dir,
  }),
  stockMovements: z.object({
    productId: id,
    type: z.string().min(1).max(40).optional(),
    from: day,
    to: day,
    sort: z.enum(["newest", "oldest"]).default("newest"),
    dir,
  }),
} satisfies Record<Resource, z.ZodType>;

export type ListParams<R extends Resource> = z.infer<
  (typeof listParamsSchemas)[R]
>;
export type ListParamsInput<R extends Resource> = z.input<
  (typeof listParamsSchemas)[R]
>;

/** Reads and fills in defaults for a list question (from a URL, a form or a test). */
export function parseListParams<R extends Resource>(
  resource: R,
  input: unknown,
): ListParams<R> {
  return listParamsSchemas[resource].parse(input ?? {}) as ListParams<R>;
}

type Doc = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** The words a record is found by: stored ones, or worked out when a record does not carry them. */
function wordsOf(resource: Resource, doc: Doc): string[] {
  if (Array.isArray(doc.searchWords)) return doc.searchWords as string[];
  if (
    resource === "products" ||
    resource === "customers" ||
    resource === "suppliers" ||
    resource === "sales" ||
    resource === "purchases"
  )
    return derivedSearchFields(resource, doc).searchWords;
  return [];
}

/** Every typed word must start some word of the record: "rah 0171" finds Rahim, 01711000001. */
function matchesQuery(resource: Resource, doc: Doc, query: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return true;
  const words = wordsOf(resource, doc);
  return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

/** A typed barcode or SKU that matches a product exactly (what a scanner sends). */
export function isExactCode(doc: Doc, query: string): boolean {
  const q = query.trim();
  return q !== "" && (doc.barcode === q || doc.sku === q);
}

const inDays = (day: string, from?: string, to?: string) =>
  (!from || day >= from) && (!to || day <= to);
const createdDay = (doc: Doc, timeZone: string) =>
  dayKey(str(doc.createdAt), timeZone);

/**
 * Does this record belong in the list for these params? Deleted records never do. `timeZone` is the
 * store's, because "today" and date ranges are store days.
 */
export function matches<R extends Resource>(
  resource: R,
  doc: Doc,
  params: ListParams<R>,
  timeZone = DEFAULT_TIME_ZONE,
): boolean {
  if (doc.deletedAt) return false;
  const p = params as Record<string, unknown>;

  switch (resource) {
    case "products": {
      if (isExactCode(doc, str(p.q))) return true;
      if (!matchesQuery(resource, doc, str(p.q))) return false;
      if (p.active === "active" && doc.isActive === false) return false;
      if (p.active === "inactive" && doc.isActive !== false) return false;
      if (p.categoryId === "none" && doc.categoryId) return false;
      if (
        p.categoryId &&
        p.categoryId !== "none" &&
        doc.categoryId !== p.categoryId
      )
        return false;
      if (p.stock !== "all") {
        const status = stockStatus({
          stock: num(doc.stock),
          lowStockThreshold: num(doc.lowStockThreshold),
        });
        // "low" means needing attention: running low or already out.
        if (p.stock === "low" && status === "ok") return false;
        if (p.stock === "out" && status !== "out") return false;
      }
      return true;
    }
    case "customers":
    case "suppliers": {
      if (!matchesQuery(resource, doc, str(p.q))) return false;
      if (p.balance === "owes" && num(doc.balance) <= 0) return false;
      if (p.balance === "advance" && num(doc.balance) >= 0) return false;
      return true;
    }
    case "sales": {
      if (!matchesQuery(resource, doc, str(p.q))) return false;
      if (!inDays(createdDay(doc, timeZone), p.from as string, p.to as string))
        return false;
      if (p.status !== "all" && doc.status !== p.status) return false;
      if (p.method && doc.paymentMethod !== p.method) return false;
      if (p.dueOnly && num(doc.due) <= 0) return false;
      if (p.customerId && doc.customerId !== p.customerId) return false;
      return true;
    }
    case "purchases": {
      if (!matchesQuery(resource, doc, str(p.q))) return false;
      if (!inDays(str(doc.date), p.from as string, p.to as string))
        return false;
      if (p.supplierId && doc.supplierId !== p.supplierId) return false;
      if (p.dueOnly && num(doc.due) <= 0) return false;
      return true;
    }
    case "expenses": {
      if (!inDays(str(doc.date), p.from as string, p.to as string))
        return false;
      if (p.category && doc.category !== p.category) return false;
      if (p.method && doc.method !== p.method) return false;
      if (p.status !== "all" && doc.status !== p.status) return false;
      return true;
    }
    case "payments": {
      if (p.type !== "all" && doc.partyType !== p.type) return false;
      if (!inDays(createdDay(doc, timeZone), p.from as string, p.to as string))
        return false;
      if (p.partyId && doc.partyId !== p.partyId) return false;
      return true;
    }
    case "returns": {
      if (p.kind !== "all" && doc.kind !== p.kind) return false;
      return inDays(
        createdDay(doc, timeZone),
        p.from as string,
        p.to as string,
      );
    }
    case "stockMovements": {
      if (p.productId && doc.productId !== p.productId) return false;
      if (p.type && doc.type !== p.type) return false;
      return inDays(
        createdDay(doc, timeZone),
        p.from as string,
        p.to as string,
      );
    }
  }
}

/** What a list is ordered by, per sort choice. */
function sortValue(
  resource: Resource,
  sort: string,
  doc: Doc,
): string | number {
  switch (sort) {
    case "name":
      return str(doc.nameKey) || normalizeSearch(str(doc.name));
    case "stock":
      return num(doc.stock);
    case "price":
      return num(doc.sellingPrice);
    case "balance":
      return num(doc.balance);
    case "total":
      return num(doc.total);
    case "due":
      return num(doc.due);
    case "amount":
      return num(doc.amount);
    default:
      // newest / oldest: expenses are by their own date, purchases by theirs, the rest by creation.
      if (resource === "expenses" || resource === "purchases")
        return `${str(doc.date)}|${str(doc.createdAt)}`;
      return str(doc.createdAt);
  }
}

const DEFAULT_DIRECTION: Record<string, "asc" | "desc"> = {
  name: "asc",
  stock: "asc",
  price: "desc",
  balance: "desc",
  newest: "desc",
  oldest: "asc",
  total: "desc",
  due: "desc",
  amount: "desc",
};

/** The direction a list is really sorted in: its natural one, or the opposite when asked. */
export function directionOf(
  sort: string,
  dir?: "asc" | "desc",
): "asc" | "desc" {
  const natural = DEFAULT_DIRECTION[sort] ?? "desc";
  if (!dir) return natural;
  return dir;
}

const cmp = (a: string | number, b: string | number) =>
  a < b ? -1 : a > b ? 1 : 0;

/**
 * Orders two records for a list. Ties are broken by id (plain byte order, in the same direction as
 * the sort) so the order is the same on every device and the server, and a page boundary never
 * splits ties randomly. (Same direction, so one index on the server serves a sort both ways.)
 */
export function compare<R extends Resource>(
  resource: R,
  a: Doc,
  b: Doc,
  params: ListParams<R>,
): number {
  const p = params as { sort: string; dir?: "asc" | "desc"; q?: string };
  if (resource === "products" && p.q) {
    const ea = isExactCode(a, p.q);
    const eb = isExactCode(b, p.q);
    if (ea !== eb) return ea ? -1 : 1; // a scanned code goes to the top
  }
  const direction = directionOf(p.sort, p.dir) === "asc" ? 1 : -1;
  const byValue = cmp(
    sortValue(resource, p.sort, a),
    sortValue(resource, p.sort, b),
  );
  return byValue !== 0
    ? byValue * direction
    : cmp(str(a.id), str(b.id)) * direction;
}

/** The reference answer: filter, sort, and return the records of one list. */
export function referenceList<R extends Resource>(
  resource: R,
  docs: Doc[],
  params: ListParams<R>,
  timeZone = DEFAULT_TIME_ZONE,
): Doc[] {
  return docs
    .filter((doc) => matches(resource, doc, params, timeZone))
    .sort((a, b) => compare(resource, a, b, params));
}

/**
 * The numbers a list's header shows, over EVERYTHING that matches (not just the page on screen).
 * `docs` are the records that already passed `matches`. Sales and expenses count only the ones that
 * stand (a cancelled sale is listed, but not in what was sold).
 */
export function referenceTotals(
  resource: Resource,
  docs: Doc[],
): Record<string, number> {
  const sum = (field: string, only?: (d: Doc) => boolean) =>
    docs.reduce((s, d) => s + (!only || only(d) ? num(d[field]) : 0), 0);
  const standing = (d: Doc) => d.status === "active";
  const out: Record<string, number> = { count: docs.length };
  switch (resource) {
    case "sales":
      out.sold = sum("total", standing);
      out.due = sum("due", standing);
      out.paid = sum("paid", standing);
      break;
    case "purchases":
      out.total = sum("total");
      out.due = sum("due");
      break;
    case "customers":
    case "suppliers":
      out.owed = docs.reduce((s, d) => s + Math.max(0, num(d.balance)), 0);
      out.advance = docs.reduce((s, d) => s + Math.max(0, -num(d.balance)), 0);
      break;
    case "expenses":
      out.amount = sum("amount", standing);
      break;
    case "payments":
      out.amount = sum("amount");
      break;
    case "returns":
      out.total = sum("total");
      break;
  }
  return out;
}
