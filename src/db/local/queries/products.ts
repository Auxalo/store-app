import { normalizeSearch } from "@/lib/search";
import type { StoreDB } from "../db";
import type { Product } from "../types";

export type StockFilter = "all" | "low" | "out";
export type StockStatus = "ok" | "low" | "out";

/** out: nothing (or less than nothing) on hand · low: at or under the product's own threshold. */
export function stockStatus(
  product: Pick<Product, "stock" | "lowStockThreshold">,
): StockStatus {
  if (product.stock <= 0) return "out";
  if (
    product.lowStockThreshold > 0 &&
    product.stock <= product.lowStockThreshold
  )
    return "low";
  return "ok";
}

export interface ProductSearch {
  query?: string;
  categoryId?: string | null;
  stock?: StockFilter;
  includeInactive?: boolean;
  limit?: number;
}

const CANDIDATE_CAP = 300;
const SMALL_SET = 100;

/**
 * Searches products on this device, never touching the network.
 *
 * Matches English name, Bangla name, SKU and barcode. The first lookup uses the `*searchWords`
 * index (prefix match on one word), so it stays fast with tens of thousands of products; the
 * remaining words and filters are then applied to that small candidate set.
 */
export async function searchProducts(
  db: StoreDB,
  search: ProductSearch = {},
): Promise<Product[]> {
  const {
    categoryId,
    stock = "all",
    includeInactive = false,
    limit = 100,
  } = search;
  const raw = (search.query ?? "").trim();
  const q = normalizeSearch(raw);

  const keep = (p: Product) =>
    !p.deletedAt &&
    (includeInactive || p.isActive) &&
    (categoryId === undefined ||
      categoryId === null ||
      p.categoryId === categoryId) &&
    (stock === "all" || stockStatus(p) === stock);

  if (!q) {
    return db.products.orderBy("name").filter(keep).limit(limit).toArray();
  }

  // A scanned or typed barcode / SKU should win outright.
  const exact = new Map<string, Product>();
  for (const p of await db.products.where("barcode").equals(raw).toArray())
    exact.set(p.id, p);
  for (const p of await db.products.where("sku").equals(raw).toArray())
    exact.set(p.id, p);

  // Split exactly like the index does (on punctuation too), so "rice-1" finds SKU "RICE-1".
  const tokens = q.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  if (tokens.length === 0)
    return [...exact.values()].filter(keep).slice(0, limit);
  // Narrow down by ids only (cheap, no records read): look up the longest word first, then
  // intersect with the next, and stop once the set is small enough to finish in memory.
  let ids: Set<string> | undefined;
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    if (ids && ids.size <= SMALL_SET) break;
    const keys = new Set(
      (await db.products
        .where("searchWords")
        .startsWith(token)
        .primaryKeys()) as string[],
    );
    ids = ids ? new Set([...ids].filter((id) => keys.has(id))) : keys;
  }
  if (!ids) return [];
  const matchesAll = (p: Product) =>
    keep(p) && tokens.every((t) => p.searchWords.some((w) => w.startsWith(t)));

  let matches: Product[];
  if (ids.size <= CANDIDATE_CAP) {
    // Few hits: read just those records and sort them.
    matches = (await db.products.bulkGet([...ids])).filter(
      (p): p is Product => !!p && matchesAll(p),
    );
    matches.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    // Many hits (a very short or common word): walk the records in name order and stop as soon
    // as there are enough, instead of reading thousands of records just to sort them.
    matches = await db.products
      .orderBy("name")
      .filter((p) => ids.has(p.id) && matchesAll(p))
      .limit(limit + exact.size)
      .toArray();
  }

  const ordered = [
    ...[...exact.values()].filter(keep),
    ...matches.filter((p) => !exact.has(p.id)),
  ];
  return ordered.slice(0, limit);
}

/** Exact barcode or SKU lookup (what a barcode scanner produces). */
export async function findProductByCode(
  db: StoreDB,
  code: string,
): Promise<Product | undefined> {
  const value = code.trim();
  if (!value) return undefined;
  const live = (p: Product) => !p.deletedAt && p.isActive;
  return (
    (await db.products.where("barcode").equals(value).filter(live).first()) ??
    (await db.products.where("sku").equals(value).filter(live).first())
  );
}

/** Whether another live product already uses this barcode or SKU (to warn before saving). */
export async function findDuplicateCode(
  db: StoreDB,
  field: "barcode" | "sku",
  value: string,
  exceptId?: string,
): Promise<Product | undefined> {
  const v = value.trim();
  if (!v) return undefined;
  return db.products
    .where(field)
    .equals(v)
    .filter((p) => !p.deletedAt && p.id !== exceptId)
    .first();
}
