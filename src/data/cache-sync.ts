import type { QueryClient } from "@tanstack/react-query";
import type { WireChange } from "@/schemas/sync";

/** Collections that make up a report (sales, money in and out, stock). */
const REPORT_SOURCES = new Set([
  "sales",
  "purchases",
  "expenses",
  "payments",
  "returns",
  "stockMovements",
  "products",
]);

const RESOURCES = new Set([
  "products",
  "customers",
  "suppliers",
  "sales",
  "purchases",
  "expenses",
  "payments",
  "returns",
  "stockMovements",
]);

type Key = readonly unknown[];

/**
 * After a save, bring the screens up to date with the least work.
 *   - The records the server returned go straight into the cache, so a receipt or a detail page
 *     shows at once without asking again.
 *   - Only the lists, totals and reports that those records belong to are marked out of date (a
 *     sale touches sales, products, customers and reports; it does not touch expenses). Marking
 *     does not wait for the refetch: the screen shows what it has and updates a moment later.
 */
export function applyResultToCache(
  client: QueryClient,
  changes: WireChange[],
): void {
  const touched = new Set(changes.map((c) => c.collection as string));

  // 1. The records themselves.
  for (const change of changes) {
    if (!RESOURCES.has(change.collection)) continue;
    const doc = change.doc as unknown as { id?: string };
    if (!doc.id) continue;
    const key: Key = ["data", "record", change.collection, doc.id];
    const old = client.getQueryData<{
      record: Record<string, unknown>;
      extra: Record<string, unknown[]>;
    }>(key);
    // A record that is not open yet is stored too (a new sale: the receipt is about to ask for it).
    client.setQueryData(key, {
      record: { ...(old?.record ?? {}), ...(doc as Record<string, unknown>) },
      extra: old?.extra ?? {},
    });
  }

  // 2. What is now out of date.
  client.invalidateQueries({
    refetchType: "active",
    predicate: ({ queryKey }) => {
      const [root, kind, resource] = queryKey as string[];
      if (root !== "data") return false;
      switch (kind) {
        case "list":
        case "totals":
          return touched.has(resource);
        case "record":
          // The record itself was just replaced above; what hangs off it may have changed.
          return (
            ((resource === "customers" || resource === "suppliers") &&
              touched.has("ledgerEntries")) ||
            (resource === "products" && touched.has("stockMovements")) ||
            ((resource === "sales" || resource === "purchases") &&
              touched.has("returns"))
          );
        case "categories":
          return touched.has("categories");
        case "summary":
          return [...touched].some((c) => REPORT_SOURCES.has(c));
        case "stock-summary":
          return touched.has("products") || touched.has("stockMovements");
        case "dashboard":
          return true;
        default:
          return false;
      }
    },
  });
}
