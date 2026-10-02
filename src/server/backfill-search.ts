import type { AnyBulkWriteOperation, Db, Document } from "mongodb";
import { derivedSearchFields, SEARCHABLE } from "@/lib/search-fields";

/**
 * Fills in the search fields (`searchWords`, `nameKey`, and a sale's `customerPhone`) on records
 * that were saved before the server kept them. Safe to run again: it only touches records that are
 * missing something, and it does not change `syncSeq`, so devices see no change and re-download
 * nothing. Run it once after deploying the version that adds server-side search.
 */
export async function backfillSearchFields(
  db: Db,
  options: { batchSize?: number } = {},
): Promise<Record<string, number>> {
  const batchSize = options.batchSize ?? 500;
  const updated: Record<string, number> = {};

  // A sale remembers its buyer's phone; older sales read it from the customer now.
  const phones = new Map<string, string>();
  for await (const c of db
    .collection("customers")
    .find({}, { projection: { phone: 1 } }))
    phones.set(String(c._id), typeof c.phone === "string" ? c.phone : "");

  for (const collection of SEARCHABLE) {
    const wantsNameKey = collection !== "sales" && collection !== "purchases";
    const missing: Document = wantsNameKey
      ? {
          $or: [
            { searchWords: { $exists: false } },
            { nameKey: { $exists: false } },
          ],
        }
      : collection === "sales"
        ? {
            $or: [
              { searchWords: { $exists: false } },
              { customerPhone: { $exists: false } },
            ],
          }
        : { searchWords: { $exists: false } };

    let count = 0;
    let ops: AnyBulkWriteOperation<Document>[] = [];
    const flush = async () => {
      if (ops.length === 0) return;
      await db.collection(collection).bulkWrite(ops, { ordered: false });
      count += ops.length;
      ops = [];
    };

    for await (const doc of db.collection(collection).find(missing)) {
      const base: Document =
        collection === "sales" && typeof doc.customerPhone !== "string"
          ? { ...doc, customerPhone: phones.get(String(doc.customerId)) ?? "" }
          : doc;
      const set: Document = { ...derivedSearchFields(collection, base) };
      if (collection === "sales") set.customerPhone = base.customerPhone;
      ops.push({
        updateOne: { filter: { _id: doc._id }, update: { $set: set } },
      });
      if (ops.length >= batchSize) await flush();
    }
    await flush();
    updated[collection] = count;
  }
  return updated;
}
