import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import { AUDIT_RETENTION_SECONDS } from "@/lib/constants";

/** Mongo collection names used by the sync engine (business collections match SYNC_COLLECTIONS). */
export const COL = {
  stores: "stores",
  devices: "devices",
  appliedOps: "appliedOps",
  users: "user", // owned by Better Auth
} as const;

/**
 * How long the "this operation was already applied" records are kept. A retry comes within hours
 * or days of the original (the answer was lost, the phone came back online), and every create is
 * also guarded by its own id, so 45 days is far more than enough. (They held a full copy of every
 * changed record for 180 days, which roughly doubled the storage a shop used.)
 */
export const APPLIED_OPS_RETENTION_SECONDS = 60 * 60 * 24 * 45;

/**
 * An expiring index. If the index already exists with another lifetime (this was 180 days), the
 * lifetime is changed in place (collMod) instead of failing.
 */
async function ensureTtl(
  db: Db,
  collection: string,
  field: string,
  seconds: number,
) {
  try {
    await db
      .collection(collection)
      .createIndex({ [field]: 1 }, { expireAfterSeconds: seconds });
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 85 && code !== 86) throw error;
    await db.command({
      collMod: collection,
      index: { keyPattern: { [field]: 1 }, expireAfterSeconds: seconds },
    });
  }
}

const ensured = new WeakSet<Db>();

/** Creates the indexes sync relies on. Idempotent; runs once per process per database. */
/**
 * The people's indexes (usernames are unique across all shops). Created when the sign-in service
 * starts, unless SKIP_RUNTIME_INDEXES=1, and by `pnpm db:indexes`.
 */
export async function ensureUserIndexes(db: Db): Promise<void> {
  await Promise.all([
    db
      .collection("user")
      .createIndex({ username: 1 }, { unique: true, sparse: true }),
    db.collection("user").createIndex({ email: 1 }, { unique: true }),
    db.collection("user").createIndex({ storeId: 1 }),
  ]);
}

export async function ensureSyncIndexes(db: Db): Promise<void> {
  if (ensured.has(db)) return;
  await Promise.all([
    db.collection("categories").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("settings").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("products").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("stockMovements").createIndex({ storeId: 1, syncSeq: 1 }),
    db
      .collection("stockMovements")
      .createIndex({ storeId: 1, productId: 1, createdAt: 1 }),
    db.collection("customers").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("sales").createIndex({ storeId: 1, syncSeq: 1 }),
    db.collection("sales").createIndex({ storeId: 1, createdAt: -1 }),
    db.collection("sales").createIndex({ storeId: 1, customerId: 1 }),
    // Searching and sorting lists on the server (see src/lib/search-fields.ts).
    db.collection("sales").createIndex({ storeId: 1, searchWords: 1 }),
    db.collection("sales").createIndex({ storeId: 1, invoiceNo: 1 }),
    db
      .collection("sales")
      .createIndex({ storeId: 1, status: 1, createdAt: -1 }),
    // One index per way a list can be sorted, ending in _id (the tie-break goes the same way as the
    // sort), so any list opens straight from an index in either direction, even with 200,000 rows.
    ...(
      [
        ["products", { stock: 1 }],
        ["products", { sellingPrice: 1 }],
        ["products", { createdAt: -1 }],
        ["products", { lowStockThreshold: -1 }],
        ["customers", { balance: -1 }],
        ["customers", { createdAt: -1 }],
        ["suppliers", { balance: -1 }],
        ["suppliers", { createdAt: -1 }],
        ["sales", { createdAt: -1 }],
        ["sales", { total: -1 }],
        ["sales", { due: -1 }],
        ["purchases", { date: -1, createdAt: -1 }],
        ["purchases", { total: -1 }],
        ["purchases", { due: -1 }],
        ["expenses", { date: -1, createdAt: -1 }],
        ["expenses", { amount: -1 }],
        ["payments", { createdAt: -1 }],
        ["payments", { amount: -1 }],
        ["returns", { createdAt: -1 }],
        ["returns", { total: -1 }],
        ["stockMovements", { createdAt: -1 }],
      ] as const
    ).map(([name, keys]) =>
      db.collection(name).createIndex({
        storeId: 1,
        ...keys,
        // The id goes the way the first key goes (that is how the tie-break is defined).
        ...("lowStockThreshold" in keys
          ? {}
          : { _id: Object.values(keys)[0] as 1 | -1 }),
      }),
    ),
    ...["products", "customers", "suppliers"].flatMap((name) => [
      db.collection(name).createIndex({ storeId: 1, searchWords: 1 }),
      db.collection(name).createIndex({ storeId: 1, nameKey: 1, _id: 1 }),
    ]),
    db.collection("products").createIndex({ storeId: 1, sku: 1 }),
    db.collection("products").createIndex({ storeId: 1, barcode: 1 }),
    db.collection("purchases").createIndex({ storeId: 1, searchWords: 1 }),
    db.collection("ledgerEntries").createIndex({ storeId: 1, syncSeq: 1 }),
    db
      .collection("ledgerEntries")
      .createIndex({ storeId: 1, partyId: 1, createdAt: 1 }),
    ...["suppliers", "purchases", "payments", "expenses", "returns"].map(
      (name) => db.collection(name).createIndex({ storeId: 1, syncSeq: 1 }),
    ),
    db.collection("returns").createIndex({ storeId: 1, kind: 1, refId: 1 }),
    db.collection("purchases").createIndex({ storeId: 1, date: -1 }),
    db
      .collection("payments")
      .createIndex({ storeId: 1, partyId: 1, createdAt: -1 }),
    db.collection("auditLogs").createIndex({ storeId: 1, at: -1 }),
    // The audit log keeps 7 days; MongoDB deletes older rows on its own (within about a minute).
    ensureTtl(db, "auditLogs", "recordedAt", AUDIT_RETENTION_SECONDS),
    db
      .collection(COL.devices)
      .createIndex({ storeId: 1, code: 1 }, { unique: true }),
    db.collection(COL.appliedOps).createIndex({ storeId: 1 }),
    // Idempotency records only need to outlive any realistic retry window.
    ensureTtl(db, COL.appliedOps, "appliedAt", APPLIED_OPS_RETENTION_SECONDS),
  ]);

  // A SKU or barcode belongs to one live product of a shop: the database refuses a second one, so
  // two devices (or two requests) saving at the same moment cannot both take it. Only live
  // products with a non-empty code count; a deleted product frees its code. A failure is logged and
  // never stops the app (run `pnpm db:check-duplicates` to find existing clashes).
  for (const field of ["sku", "barcode"] as const) {
    const options: CreateIndexesOptions = {
      unique: true,
      name: `uniq_live_${field}`,
      partialFilterExpression: {
        deletedAt: null,
        [field]: { $type: "string", $gt: "" },
      },
    };
    await db
      .collection("products")
      .createIndex({ storeId: 1, [field]: 1 }, options)
      .catch((error: unknown) =>
        console.error(`unique index on product ${field} not created`, error),
      );
  }

  // Better Auth creates no indexes of its own for its collections. Without these, every session
  // lookup scans every session ever made, and old sessions are never cleaned up. They are created
  // one by one and a failure is only logged, so an odd old row can never stop the app starting.
  const authIndexes: Array<
    [string, IndexSpecification, CreateIndexesOptions?]
  > = [
    ["session", { token: 1 }, { unique: true }],
    ["session", { userId: 1 }],
    // Sessions last 30 days; MongoDB removes them when they expire.
    ["session", { expiresAt: 1 }, { expireAfterSeconds: 0 }],
    ["account", { userId: 1 }],
    ["rateLimit", { key: 1 }],
    // Billing and the operator's log (src/server/billing.ts, src/server/admin-shops.ts).
    ["billingPayments", { storeId: 1, submittedAt: -1 }],
    ["billingPayments", { status: 1, submittedAt: 1 }],
    // A transaction id is used once, by any shop (a rejected payment frees it: trxKey is removed).
    [
      "billingPayments",
      { trxKey: 1 },
      {
        unique: true,
        name: "uniq_trx",
        partialFilterExpression: { trxKey: { $type: "string" } },
      },
    ],
    ["platformAudit", { at: -1 }],
    ["platformAudit", { storeId: 1, at: -1 }],
  ];
  await Promise.all(
    authIndexes.map(([name, keys, options]) =>
      db
        .collection(name)
        .createIndex(keys, options)
        .catch((error: unknown) =>
          console.error(
            `index ${name} ${JSON.stringify(keys)} not created`,
            error,
          ),
        ),
    ),
  );
  ensured.add(db);
}
