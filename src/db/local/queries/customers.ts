import { normalizeSearch } from "@/lib/search";
import type { StoreDB } from "../db";
import type { Customer } from "../types";

/** Searches customers by name or mobile number (Bangla or English), on the device. */
export async function searchCustomers(
  db: StoreDB,
  query = "",
  limit = 50,
): Promise<Customer[]> {
  const q = normalizeSearch(query);
  const live = (c: Customer) => !c.deletedAt;
  if (!q)
    return db.customers.orderBy("name").filter(live).limit(limit).toArray();

  const tokens = q.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  if (tokens.length === 0) return [];
  const lead = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  const hits = await db.customers
    .where("searchWords")
    .startsWith(lead)
    .distinct()
    .toArray();
  return hits
    .filter(
      (c) =>
        live(c) &&
        tokens.every((t) => c.searchWords.some((w) => w.startsWith(t))),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}
