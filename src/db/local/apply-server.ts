import type { SyncCollection } from "@/commands/definitions";
import type { WireDoc } from "@/schemas/sync";
import type { StoreDB } from "./db";
import type { OutboxOp, OutboxStatus } from "./types";

/** Operations whose effect the device still shows but the server has not confirmed. */
const UNCONFIRMED: readonly OutboxStatus[] = ["pending", "syncing", "conflict"];

type Doc = WireDoc & Record<string, unknown>;

/** Re-applies one unconfirmed local operation on top of a server record. */
function overlay(doc: Doc, op: OutboxOp): Doc {
  const payload = op.payload as Record<string, unknown>;
  const bump = { version: doc.version + 1, updatedAt: op.createdAt };
  switch (op.type) {
    case "category.update":
      return { ...doc, ...(payload.changes as object), ...bump };
    case "category.delete":
      return { ...doc, deletedAt: op.createdAt, ...bump };
    case "setting.set":
      return { ...doc, value: payload.value, ...bump };
    default:
      return doc; // creates: the server already has the record
  }
}

/**
 * Writes server records into the device database WITHOUT losing local edits that have not synced.
 *
 * For each record: take the server's state, then replay every unconfirmed local operation on top.
 * So a pull that arrives while the cashier has unsynced edits never makes their change vanish,
 * and the version counter stays "server version + edits still in the queue".
 *
 * Must run inside a transaction that includes the target table and `outbox`.
 */
export async function applyServerDocs(
  db: StoreDB,
  collection: SyncCollection,
  docs: WireDoc[],
): Promise<void> {
  if (docs.length === 0) return;
  const table = db.table(collection);

  for (const incoming of docs) {
    const local = await table.get(incoming.id);
    // Older than what we already have (e.g. a duplicate delivery): ignore.
    if (local?.syncSeq !== undefined && incoming.syncSeq < local.syncSeq)
      continue;

    const unconfirmed = await db.outbox
      .where("entityId")
      .equals(incoming.id)
      .filter(
        (op) => op.collection === collection && UNCONFIRMED.includes(op.status),
      )
      .sortBy("seq");

    const merged = unconfirmed.reduce<Doc>(
      (doc, op) => overlay(doc, op),
      incoming as Doc,
    );
    await table.put(merged);
  }
}
