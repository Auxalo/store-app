import { applyServerDocs } from "@/db/local/apply-server";
import type { StoreDB } from "@/db/local/db";
import { setMeta } from "@/db/local/meta";
import { undoLocalEffects } from "./undo";

/**
 * Settles an operation the server flagged as a conflict (both devices changed an important field).
 *   mine   → send it again, now based on the server's current version, so it wins
 *   server → drop it and show the server's version
 */
export async function resolveConflict(
  db: StoreDB,
  operationId: string,
  choice: "mine" | "server",
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const op = await db.outbox.where("operationId").equals(operationId).first();
    if (op?.status !== "conflict") return;
    const seq = op.seq as number;
    const server = op.serverDoc;

    if (choice === "mine") {
      const payload = {
        ...(op.payload as Record<string, unknown>),
        baseVersion: server?.version ?? 0,
      };
      await db.outbox.update(seq, {
        status: "pending",
        payload,
        attempts: 0,
        nextAttemptAt: 0,
        serverDoc: undefined,
        lastError: undefined,
      });
      if (server) await applyServerDocs(db, op.collection, [server]); // re-derive local state with this op replayed
    } else {
      await db.outbox.delete(seq);
      if (server) await applyServerDocs(db, op.collection, [server]);
    }
  });
}

/** Puts a failed operation back in the queue (e.g. after the cause was fixed). */
export async function retryOperation(
  db: StoreDB,
  operationId: string,
): Promise<void> {
  await db.outbox
    .where("operationId")
    .equals(operationId)
    .filter((op) => op.status === "failed")
    .modify({
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
      lastError: undefined,
    });
}

/**
 * Abandons a failed operation and undoes what it showed on screen.
 * If the server gave us its version we restore that; otherwise a created record is removed, and for
 * edits we re-download from the start so the screen converges on the server's truth.
 */
export async function discardOperation(
  db: StoreDB,
  operationId: string,
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const op = await db.outbox.where("operationId").equals(operationId).first();
    if (op?.status !== "failed") return;
    await db.outbox.delete(op.seq as number);
    await undoLocalEffects(db, op);

    if (op.serverDoc) await applyServerDocs(db, op.collection, [op.serverDoc]);
    else if (op.type.endsWith(".create"))
      await db.table(op.collection).delete(op.entityId);
    else await setMeta(db, "cursor", 0);
  });
}
