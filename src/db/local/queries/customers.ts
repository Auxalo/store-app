import { normalizeSearch } from "@/lib/search";
import type { StoreDB } from "../db";
import type { Customer, Supplier } from "../types";

export type PartyKind = "customer" | "supplier";
export type Party = Customer | Supplier;

/** Searches customers or suppliers by name or mobile number (Bangla or English), on the device. */
export async function searchParties(
  db: StoreDB,
  kind: PartyKind,
  query = "",
  limit = 50,
): Promise<Party[]> {
  const table = (
    kind === "customer" ? db.customers : db.suppliers
  ) as typeof db.customers;
  const q = normalizeSearch(query);
  const live = (p: Party) => !p.deletedAt;
  if (!q) return table.orderBy("name").filter(live).limit(limit).toArray();

  const tokens = q.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  if (tokens.length === 0) return [];
  const lead = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  const hits = await table
    .where("searchWords")
    .startsWith(lead)
    .distinct()
    .toArray();
  return hits
    .filter(
      (p) =>
        live(p) &&
        tokens.every((t) => p.searchWords.some((w) => w.startsWith(t))),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

export const searchCustomers = (db: StoreDB, query = "", limit = 50) =>
  searchParties(db, "customer", query, limit) as Promise<Customer[]>;
export const searchSuppliers = (db: StoreDB, query = "", limit = 50) =>
  searchParties(db, "supplier", query, limit) as Promise<Supplier[]>;
