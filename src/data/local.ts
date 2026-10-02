import Dexie from "dexie";
import type { StoreDB } from "@/db/local/db";
import { queryTokens } from "@/lib/search-fields";
import { rangeBounds } from "@/reports/compute";
import {
  type ListParams,
  matches,
  type Resource,
  referenceList,
  referenceTotals,
} from "./spec";

/**
 * The device's half of the list rules in `spec.ts`: it finds the candidates with an index (the
 * search words, or a date range) and then applies the plain reference rules to them, so the
 * answer is by construction the one the rules give. Used in offline mode, where the whole shop
 * is in IndexedDB.
 */
type Doc = Record<string, unknown>;

const SEARCHABLE: ReadonlySet<Resource> = new Set([
  "products",
  "customers",
  "suppliers",
  "sales",
  "purchases",
]);
/** Resources that have a `createdAt` index, and those with a `date` index. */
const BY_CREATED = new Set<Resource>([
  "sales",
  "payments",
  "returns",
  "stockMovements",
]);
const BY_DATE = new Set<Resource>(["purchases", "expenses"]);

async function candidates(
  db: StoreDB,
  resource: Resource,
  params: ListParams<Resource>,
  timeZone: string,
): Promise<Doc[]> {
  const table = db.table(resource);
  const p = params as { q?: string; from?: string; to?: string };

  // A typed search: start from the records whose words begin with the longest typed word.
  const q = (p.q ?? "").trim();
  if (SEARCHABLE.has(resource) && q) {
    const ids = new Set<string>();
    const tokens = queryTokens(q).sort((a, b) => b.length - a.length);
    if (tokens[0])
      for (const id of await table
        .where("searchWords")
        .startsWith(tokens[0])
        .primaryKeys())
        ids.add(String(id));
    // A scanned barcode or SKU always finds its product, whatever else is typed.
    if (resource === "products") {
      for (const field of ["barcode", "sku"])
        for (const id of await table.where(field).equals(q).primaryKeys())
          ids.add(String(id));
    }
    if (tokens.length > 0 || ids.size > 0)
      return (await table.bulkGet([...ids])).filter((d): d is Doc => !!d);
  }

  // A date range: only the records inside it.
  if ((p.from || p.to) && (BY_CREATED.has(resource) || BY_DATE.has(resource))) {
    if (BY_CREATED.has(resource)) {
      const start = p.from
        ? rangeBounds({ from: p.from, to: p.from }, timeZone).start
        : Dexie.minKey;
      const end = p.to
        ? rangeBounds({ from: p.to, to: p.to }, timeZone).end
        : Dexie.maxKey;
      return table
        .where("createdAt")
        .between(start, end, true, false)
        .toArray();
    }
    return table
      .where("date")
      .between(p.from ?? Dexie.minKey, p.to ?? Dexie.maxKey, true, true)
      .toArray();
  }
  return table.toArray();
}

export interface LocalPage {
  items: Doc[];
  /** How many records match in all, so "is there more?" is known. */
  total: number;
}

/** The first `limit` records of a list, in the order of the rules. */
export async function localList(
  db: StoreDB,
  resource: Resource,
  params: ListParams<Resource>,
  limit: number,
  timeZone: string,
): Promise<LocalPage> {
  const sorted = referenceList(
    resource,
    await candidates(db, resource, params, timeZone),
    params,
    timeZone,
  );
  const items = sorted.slice(0, limit);
  if (resource === "stockMovements") await addProductNames(db, items);
  return { items, total: sorted.length };
}

/** Same as the server: a stock movement carries its product name so a list can show it. */
async function addProductNames(db: StoreDB, items: Doc[]) {
  const products = await db.products.bulkGet([
    ...new Set(
      items.map((i) => String((i as { productId?: string }).productId)),
    ),
  ]);
  const byId = new Map(products.filter((p) => !!p).map((p) => [p?.id, p]));
  for (const item of items as Array<Record<string, unknown>>) {
    const p = byId.get(String(item.productId));
    item.productName = p?.name ?? "";
    item.productNameBn = p?.nameBn ?? "";
  }
}

/** Counts and sums over everything that matches (not one page). */
export async function localTotals(
  db: StoreDB,
  resource: Resource,
  params: ListParams<Resource>,
  timeZone: string,
): Promise<Record<string, number>> {
  const matching = (await candidates(db, resource, params, timeZone)).filter(
    (d) => matches(resource, d, params, timeZone),
  );
  return referenceTotals(resource, matching);
}

const lineNumber = (id: unknown) => Number(String(id).split(":i")[1]);

/** One record with what its own screen needs: the same shape the server gives. */
export async function localRecord(
  db: StoreDB,
  resource: Resource,
  id: string,
): Promise<{ record: Doc; extra: Record<string, Doc[]> } | null> {
  const doc = (await db.table(resource).get(id)) as Doc | undefined;
  if (!doc) return null;
  const extra: Record<string, Doc[]> = {};
  let record = doc;

  if (resource === "sales") {
    const items = (await db.saleItems
      .where("saleId")
      .equals(id)
      .toArray()) as unknown as Doc[];
    record = {
      ...doc,
      items: items.sort((a, b) => lineNumber(a.id) - lineNumber(b.id)),
    };
    extra.returns = (
      await db.returns.where("refId").equals(id).toArray()
    ).filter((r) => r.kind === "sale") as unknown as Doc[];
  } else if (resource === "purchases") {
    const items = (await db.purchaseItems
      .where("purchaseId")
      .equals(id)
      .toArray()) as unknown as Doc[];
    record = {
      ...doc,
      items: items.sort((a, b) => lineNumber(a.id) - lineNumber(b.id)),
    };
    extra.returns = (
      await db.returns.where("refId").equals(id).toArray()
    ).filter((r) => r.kind === "purchase") as unknown as Doc[];
  } else if (resource === "products") {
    extra.stockMovements = (await db.stockMovements
      .where("[productId+createdAt]")
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .reverse()
      .limit(100)
      .toArray()) as unknown as Doc[];
  } else if (resource === "customers" || resource === "suppliers") {
    extra.ledgerEntries = (await db.ledgerEntries
      .where("[partyId+createdAt]")
      .between([id, Dexie.minKey], [id, Dexie.maxKey])
      .reverse()
      .limit(200)
      .toArray()) as unknown as Doc[];
  }
  return { record, extra };
}

/** A scanned or typed barcode or SKU: the one active product it belongs to. */
export async function localLookup(
  db: StoreDB,
  code: string,
): Promise<Doc | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  for (const field of ["barcode", "sku"]) {
    const found = await db.products
      .where(field)
      .equals(trimmed)
      .filter((p) => !p.deletedAt && p.isActive !== false)
      .first();
    if (found) return found as unknown as Doc;
  }
  return null;
}
