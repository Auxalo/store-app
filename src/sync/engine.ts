import Dexie from "dexie";
import { ingestStamp } from "@/billing/client";
import { SYNC_COLLECTIONS } from "@/commands/definitions";
import { applyServerDocs } from "@/db/local/apply-server";
import type { StoreDB } from "@/db/local/db";
import { getMeta, setMeta } from "@/db/local/meta";
import type { OutboxOp } from "@/db/local/types";
import {
  MAX_OPS_PER_PUSH,
  type OpEnvelope,
  type PushResponse,
} from "@/schemas/sync";
import { backoffDelay } from "./backoff";
import { type SyncTransport, TransportError } from "./transport";
import { undoLocalEffects } from "./undo";

export interface EngineOptions {
  deviceId: string;
  appVersion: string;
  now?: () => number;
  /** Position reached while downloading (the sync manager shows it while a device is preparing). */
  onPullProgress?: (cursor: number) => void;
}

const MAX_BATCHES_PER_RUN = 40;
/**
 * A request may not be larger than the server accepts (1,000,000 bytes). A batch is closed before
 * it gets near that, so a queue of big sales is sent in several requests instead of one that is
 * refused for ever.
 */
const MAX_BATCH_BYTES = 700_000;
/** How long a device waits after "this shop is paused" or "update the app" before it asks again. */
const HOLD_MS = 60_000;
const encoder = new TextEncoder();
const MAX_PAGES_PER_RUN = 2000;

const toEnvelope = (op: OutboxOp): OpEnvelope => ({
  operationId: op.operationId,
  type: op.type,
  schemaVersion: op.schemaVersion,
  payload: op.payload,
  actorUserId: op.actorUserId,
  deviceId: op.deviceId,
  createdAt: op.createdAt,
});

/** After a crash, operations marked `syncing` may or may not have reached the server. Re-send them: the server de-duplicates. */
export async function recoverInterrupted(db: StoreDB): Promise<void> {
  await db.outbox
    .where("status")
    .equals("syncing")
    .modify({ status: "pending" });
}

/** Called when connectivity returns: stop waiting out old backoff delays. */
export async function resetBackoff(db: StoreDB): Promise<void> {
  await db.outbox
    .where("status")
    .equals("pending")
    .modify({ nextAttemptAt: 0 });
}

async function requeueAfterFailure(
  db: StoreDB,
  ops: OutboxOp[],
  error: unknown,
  now: number,
) {
  // A paused shop, an app that is too old, or a refused device are not "attempts" that wear out
  // the operation, but asking again a moment later changes nothing either: wait a minute. (Without
  // a wait the device asked again every second, for ever.) A device that is merely not registered
  // yet (401) counts as an attempt and backs off like any failure.
  const hold =
    error instanceof TransportError &&
    (error.kind === "suspended" ||
      error.kind === "upgrade" ||
      (error.kind === "auth" && error.status !== 401));
  await db.transaction("rw", db.outbox, async () => {
    for (const op of ops) {
      const attempts = op.attempts + (hold ? 0 : 1);
      await db.outbox.update(op.seq as number, {
        status: "pending",
        attempts,
        nextAttemptAt: hold ? now + HOLD_MS : now + backoffDelay(attempts),
        lastError: error instanceof Error ? error.message : "unknown",
      });
    }
  });
}

async function applyPushResults(
  db: StoreDB,
  sent: OutboxOp[],
  response: PushResponse,
  now: number,
) {
  const results = new Map(response.results.map((r) => [r.operationId, r]));

  await db.transaction("rw", db.tables, async () => {
    for (const op of sent) {
      const seq = op.seq as number;
      const result = results.get(op.operationId);

      if (!result || result.status === "retry") {
        const attempts = op.attempts + 1;
        await db.outbox.update(seq, {
          status: "pending",
          attempts,
          nextAttemptAt: now + backoffDelay(attempts),
          lastError: "SERVER_BUSY",
        });
        continue;
      }

      const docs = result.docs ?? [];
      const own = docs
        .filter((c) => c.collection === op.collection)
        .map((c) => c.doc);

      if (result.status === "applied" || result.status === "duplicate") {
        // Mark confirmed first so the overlay below no longer replays this operation.
        await db.outbox.update(seq, {
          status: "synced",
          syncedAt: now,
          lastError: undefined,
        });
        for (const collection of SYNC_COLLECTIONS) {
          await applyServerDocs(
            db,
            collection,
            docs.filter((c) => c.collection === collection).map((c) => c.doc),
          );
        }
      } else if (result.status === "conflict") {
        await db.outbox.update(seq, {
          status: "conflict",
          serverDoc: own[0],
          lastError: "CONFLICT",
        });
      } else {
        // Rejected: permanent. Show the server's version again so the screen stops showing a change that will never apply.
        await db.outbox.update(seq, {
          status: "failed",
          serverDoc: own[0],
          lastError: result.error ?? "REJECTED",
        });
        // Take back what the operation did to the rest of the device (stock, balances, lines).
        await undoLocalEffects(db, op);
        if (own.length) await applyServerDocs(db, op.collection, own);
        else if (op.type.endsWith(".create"))
          await db.table(op.collection).delete(op.entityId);
      }
    }
  });
}

/** Sends every due operation, in order, in batches. */
export async function pushAll(
  db: StoreDB,
  transport: SyncTransport,
  options: EngineOptions,
): Promise<{ sent: number }> {
  const clock = options.now ?? Date.now;
  let sent = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
    const now = clock();
    const queued = await db.outbox
      .where("[status+seq]")
      .between(["pending", Dexie.minKey], ["pending", Dexie.maxKey])
      .limit(MAX_OPS_PER_PUSH)
      .toArray();
    // Strictly in order. The queue stops at the first operation that is still waiting: a later
    // operation (a sale) must never reach the server before an earlier one it depends on (the
    // customer or the product it uses), or its effects are lost. A batch is also closed before it
    // gets too big for the server.
    const due: OutboxOp[] = [];
    let bytes = 0;
    for (const op of queued) {
      if (op.nextAttemptAt > now) break;
      const size = encoder.encode(JSON.stringify(toEnvelope(op))).length;
      if (due.length > 0 && bytes + size > MAX_BATCH_BYTES) break;
      due.push(op);
      bytes += size;
    }
    if (due.length === 0) break;

    await db.outbox.bulkUpdate(
      due.map((op) => ({
        key: op.seq as number,
        changes: { status: "syncing" as const },
      })),
    );

    let response: PushResponse;
    try {
      response = await transport.push({
        deviceId: options.deviceId,
        appVersion: options.appVersion,
        ops: due.map(toEnvelope),
      });
    } catch (error) {
      await requeueAfterFailure(db, due, error, clock());
      throw error;
    }

    await applyPushResults(db, due, response, clock());
    sent += due.length;
    // Something needs backing off: stop here, the manager will come back after the delay.
    if (response.results.some((r) => r.status === "retry")) break;
  }
  return { sent };
}

/** Downloads everything that changed since this device's cursor, page by page. */
export async function pullAll(
  db: StoreDB,
  transport: SyncTransport,
  options: {
    /** Bigger pages for the one-time download. */
    limit?: number;
    /** Called after each saved page with the position reached (to show a progress bar). */
    onProgress?: (cursor: number) => void;
  } = {},
): Promise<{ pages: number; docs: number }> {
  let cursor = (await getMeta(db, "cursor")) ?? 0;
  let pages = 0;
  let docs = 0;

  while (pages < MAX_PAGES_PER_RUN) {
    const before = Date.now();
    const page = await transport.pull(cursor, options.limit);
    const after = Date.now();

    // Apply the page and advance the cursor atomically: a crash mid-pull just repeats this page.
    await db.transaction("rw", db.tables, async () => {
      for (const collection of SYNC_COLLECTIONS) {
        const changed = page.changes[collection] ?? [];
        docs += changed.length;
        await applyServerDocs(db, collection, changed);
      }
      await setMeta(db, "cursor", page.cursor);
    });
    await setMeta(
      db,
      "clockOffsetMs",
      Date.parse(page.serverTime) - (before + after) / 2,
    );
    if (page.billing) await ingestStamp(page.billing, before, after);

    pages++;
    cursor = page.cursor;
    options.onProgress?.(cursor);
    if (!page.hasMore) break;
  }
  return { pages, docs };
}

export interface SyncOutcome {
  pushed: number;
  pages: number;
  pulled: number;
}

/** One full sync: send local changes, then fetch other devices' changes. */
export async function syncOnce(
  db: StoreDB,
  transport: SyncTransport,
  options: EngineOptions,
): Promise<SyncOutcome> {
  const { sent } = await pushAll(db, transport, options);
  const { pages, docs } = await pullAll(db, transport, {
    onProgress: options.onPullProgress,
  });
  await setMeta(db, "lastSyncAt", (options.now ?? Date.now)());
  return { pushed: sent, pages, pulled: docs };
}
