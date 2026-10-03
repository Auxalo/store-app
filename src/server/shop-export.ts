import { createHash } from "node:crypto";
import { BSON, type Db, type Document, type ObjectId } from "mongodb";

const { EJSON } = BSON;

/**
 * Backup and restore of ONE shop, as a plain text file (one record per line).
 *
 * Export reads only that shop's records. Restore writes only that shop's records, and refuses a file
 * that holds anything of another shop, so a wrong or tampered file can never overwrite someone else.
 * Passwords are included (as the hashes the database keeps), so people can sign in again after a
 * restore. Treat an export like the password file it is.
 */

export const EXPORT_FORMAT = 1;

/** Collections whose records carry a `storeId`. */
export const SHOP_COLLECTIONS = [
  "categories",
  "settings",
  "products",
  "stockMovements",
  "customers",
  "suppliers",
  "sales",
  "purchases",
  "expenses",
  "payments",
  "returns",
  "ledgerEntries",
  "auditLogs",
  "devices",
] as const;

export interface ExportHeader {
  type: "header";
  format: number;
  app: "store-app";
  exportedAt: string;
  storeId: string;
  storeName: string;
  counts: Record<string, number>;
}

interface Line {
  /** Collection name. */
  c: string;
  /** The record, as extended JSON (keeps ids and dates exactly). */
  d: unknown;
}

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What belongs to a shop, per collection (counters have no storeId: their ids start with it). */
function shopFilter(collection: string, storeId: string): Document {
  if (collection === "counters")
    return { _id: { $regex: `^${escapeRegex(storeId)}:` } };
  return { storeId };
}

/** The ids of a shop's people, in both forms a reference to them may be stored in. */
async function userIds(
  db: Db,
  storeId: string,
): Promise<Array<string | ObjectId>> {
  const users = await db
    .collection("user")
    .find({ storeId }, { projection: { _id: 1 } })
    .toArray();
  return users.flatMap((u) => [u._id as ObjectId, String(u._id)]);
}

/**
 * Streams a shop to `write`, one line at a time (header, records, footer with a checksum). Memory
 * stays small however big the shop is.
 */
export async function exportShop(
  db: Db,
  storeId: string,
  write: (line: string) => void | Promise<void>,
): Promise<ExportHeader> {
  const store = await db
    .collection("stores")
    .findOne({ _id: storeId as never });
  if (!store) throw new Error("STORE_NOT_FOUND");

  const ids = await userIds(db, storeId);
  const plan: Array<[string, Document]> = [
    ["user", { storeId }],
    ["account", { userId: { $in: ids } }],
    ["counters", shopFilter("counters", storeId)],
    ...SHOP_COLLECTIONS.map((name): [string, Document] => [
      name,
      shopFilter(name, storeId),
    ]),
  ];

  const counts: Record<string, number> = { stores: 1 };
  for (const [name, filter] of plan)
    counts[name] = await db.collection(name).countDocuments(filter);

  const header: ExportHeader = {
    type: "header",
    format: EXPORT_FORMAT,
    app: "store-app",
    exportedAt: new Date().toISOString(),
    storeId,
    storeName: String(store.name ?? ""),
    counts,
  };
  await write(JSON.stringify(header));

  const sum = createHash("sha256");
  const emit = async (c: string, d: Document) => {
    const line = JSON.stringify({
      c,
      d: EJSON.serialize(d, { relaxed: false }),
    } satisfies Line);
    sum.update(line);
    await write(line);
  };
  await emit("stores", store);
  for (const [name, filter] of plan) {
    const cursor = db.collection(name).find(filter).sort({ _id: 1 });
    for await (const doc of cursor) await emit(name, doc);
  }
  await write(JSON.stringify({ type: "footer", checksum: sum.digest("hex") }));
  return header;
}

export class RestoreError extends Error {
  constructor(
    public readonly code:
      | "BAD_FILE"
      | "BAD_CHECKSUM"
      | "COUNT_MISMATCH"
      | "FOREIGN_RECORD"
      | "SHOP_EXISTS"
      | "USERNAME_TAKEN",
    detail = "",
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export interface VerifyResult {
  header: ExportHeader;
  counts: Record<string, number>;
}

/**
 * Reads the whole file once without writing anything: checks its shape, the checksum, the counts,
 * and that every record belongs to the shop named in the header.
 */
export async function verifyExport(
  lines: AsyncIterable<string>,
): Promise<VerifyResult> {
  let header: ExportHeader | null = null;
  let footer: { checksum: string } | null = null;
  const sum = createHash("sha256");
  const counts: Record<string, number> = {};
  const userIdsSeen = new Set<string>();
  const accounts: Array<unknown> = [];

  for await (const raw of lines) {
    if (!raw.trim()) continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      throw new RestoreError("BAD_FILE", "a line is not valid");
    }
    const obj = line as Record<string, unknown>;
    if (obj.type === "header") {
      if (header) throw new RestoreError("BAD_FILE", "two headers");
      header = obj as unknown as ExportHeader;
      if (header.app !== "store-app" || header.format !== EXPORT_FORMAT)
        throw new RestoreError("BAD_FILE", "not an export of this app");
      continue;
    }
    if (obj.type === "footer") {
      footer = obj as unknown as { checksum: string };
      continue;
    }
    if (!header) throw new RestoreError("BAD_FILE", "no header first");
    sum.update(raw);
    const entry = line as Line;
    const doc = EJSON.deserialize(entry.d as never) as Document;
    counts[entry.c] = (counts[entry.c] ?? 0) + 1;

    // Every record must be this shop's, and nothing else.
    const storeId = header.storeId;
    let mine: boolean;
    if (entry.c === "stores") mine = String(doc._id) === storeId;
    else if (entry.c === "counters")
      mine = String(doc._id).startsWith(`${storeId}:`);
    else if (entry.c === "account") {
      accounts.push(doc.userId);
      mine = true; // checked below against the people in this file
    } else if (entry.c === "user") {
      mine = doc.storeId === storeId;
      userIdsSeen.add(String(doc._id));
    } else
      mine =
        (SHOP_COLLECTIONS as readonly string[]).includes(entry.c) &&
        doc.storeId === storeId;
    if (!mine)
      throw new RestoreError("FOREIGN_RECORD", `${entry.c} ${String(doc._id)}`);
  }

  if (!header || !footer) throw new RestoreError("BAD_FILE", "incomplete file");
  for (const userId of accounts)
    if (!userIdsSeen.has(String(userId)))
      throw new RestoreError(
        "FOREIGN_RECORD",
        "an account of someone outside this shop",
      );
  if (footer.checksum !== sum.digest("hex"))
    throw new RestoreError("BAD_CHECKSUM");
  for (const [name, expected] of Object.entries(header.counts))
    if ((counts[name] ?? 0) !== expected)
      throw new RestoreError(
        "COUNT_MISMATCH",
        `${name}: ${counts[name] ?? 0} of ${expected}`,
      );
  return { header, counts };
}

/** Fields of the shop record that belong to the operator, kept as they are by a restore. */
const OPERATOR_FIELDS = ["billing", "status", "contactPhone", "adminNote"];

/** Deletes every record of ONE shop (scoped by the shop in every collection). */
export async function wipeShop(db: Db, storeId: string): Promise<void> {
  const ids = await userIds(db, storeId);
  await db.collection("account").deleteMany({ userId: { $in: ids } });
  await db.collection("session").deleteMany({ userId: { $in: ids } });
  await db.collection("user").deleteMany({ storeId });
  await db.collection("counters").deleteMany(shopFilter("counters", storeId));
  for (const name of SHOP_COLLECTIONS)
    await db.collection(name).deleteMany(shopFilter(name, storeId));
  await db.collection("appliedOps").deleteMany({ storeId });
  await db.collection("stores").deleteOne({ _id: storeId as never });
}

/**
 * Puts a shop back from an export. `source` is called twice (once to verify, once to write), so a
 * big file is streamed, never held in memory. The shop's own record is written last: a restore that
 * stops half way leaves no shop record, and running it again with `replace` cleans up and starts over.
 */
export async function restoreShop(
  db: Db,
  source: () => AsyncIterable<string>,
  options: { replace?: boolean; dryRun?: boolean } = {},
): Promise<VerifyResult> {
  const verified = await verifyExport(source());
  if (options.dryRun) return verified;
  const storeId = verified.header.storeId;

  const exists = await db
    .collection("stores")
    .findOne({ _id: storeId as never });
  if (exists && !options.replace)
    throw new RestoreError("SHOP_EXISTS", storeId);

  // A username belongs to one person in the whole database: it must not already be someone else's.
  const names: string[] = [];
  for await (const raw of source()) {
    if (!raw.includes('"c":"user"')) continue;
    const entry = JSON.parse(raw) as Line;
    const doc = EJSON.deserialize(entry.d as never) as Document;
    if (typeof doc.username === "string") names.push(doc.username);
  }
  if (names.length > 0) {
    const taken = await db
      .collection("user")
      .find({ username: { $in: names }, storeId: { $ne: storeId } })
      .project({ username: 1 })
      .toArray();
    if (taken.length > 0)
      throw new RestoreError("USERNAME_TAKEN", String(taken[0].username));
  }

  // What the operator decided about the shop (billing, a pause, their notes) is not part of the
  // shop's data: restoring an old backup must not bring back an old end date or undo a pause.
  const keep: Document = {};
  if (exists)
    for (const field of OPERATOR_FIELDS)
      if (exists[field] !== undefined) keep[field] = exists[field];

  if (options.replace) await wipeShop(db, storeId);

  const batches = new Map<string, Document[]>();
  const flush = async (name: string) => {
    const docs = batches.get(name);
    if (docs?.length)
      await db.collection(name).insertMany(docs, { ordered: false });
    batches.set(name, []);
  };
  let storeDoc: Document | null = null;
  for await (const raw of source()) {
    if (!raw.includes('"c":"')) continue; // header and footer lines
    const entry = JSON.parse(raw) as Line;
    const doc = EJSON.deserialize(entry.d as never) as Document;
    if (entry.c === "stores") {
      storeDoc = doc;
      continue;
    }
    const batch = batches.get(entry.c) ?? [];
    batch.push(doc);
    batches.set(entry.c, batch);
    if (batch.length >= 500) await flush(entry.c);
  }
  for (const name of [...batches.keys()]) await flush(name);
  if (storeDoc)
    await db.collection("stores").insertOne({ ...storeDoc, ...keep });
  return verified;
}
