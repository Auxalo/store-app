import { getDb } from "@/db/server/mongo";

/**
 * Finds live products that share a SKU or barcode inside one shop. The database now refuses such a
 * clash (a unique index per shop); this reports the ones that already exist, so they can be fixed
 * before the index can be built on an existing database.
 */
const db = await getDb();
let found = 0;
for (const field of ["sku", "barcode"] as const) {
  const clashes = await db
    .collection("products")
    .aggregate([
      { $match: { deletedAt: null, [field]: { $type: "string", $gt: "" } } },
      {
        $group: {
          _id: { storeId: "$storeId", value: `$${field}` },
          ids: { $push: "$_id" },
          names: { $push: "$name" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  for (const c of clashes) {
    found++;
    console.log(
      `${field} "${c._id.value}" in shop ${c._id.storeId} is used by ${c.count} products: ${c.names.join(", ")} (ids ${c.ids.join(", ")})`,
    );
  }
}
console.log(
  found === 0
    ? "No SKU or barcode is used twice inside a shop."
    : `\n${found} clash(es). Change or delete one product of each pair, then run pnpm db:indexes.`,
);
process.exit(0);
