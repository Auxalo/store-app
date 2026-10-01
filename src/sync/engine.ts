import Dexie from "dexie";
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

export interface EngineOptions {
  deviceId: string;
  appVersion: string;
  now?: () => number;
}

const MAX_BATCHES_PER_RUN = 40;
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
  const countsAsAttempt =
    error instanceof TransportError
      ? error.kind === "network" || error.kind === "server"
      : true;
  await db.transaction("rw", db.outbox, async () => {
    for (const op of ops) {
      const attempts = op.attempts + (countsAsAttempt ? 1 : 0);
      await db.outbox.update(op.seq as number, {
        status: "pending",
        attempts,
        nextAttemptAt: countsAsAttempt
          ? now + backoffDelay(attempts)
          : op.nextAttemptAt,
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
    const due = await db.outbox
      .where("[status+seq]")
      .between(["pending", Dexie.minKey], ["pending", Dexie.maxKey])
      .filter((op) => op.nextAttemptAt <= now)
      .limit(MAX_OPS_PER_PUSH)
      .toArray();
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
): Promise<{ pages: number; docs: number }> {
  let cursor = (await getMeta(db, "cursor")) ?? 0;
  let pages = 0;
  let docs = 0;

  while (pages < MAX_PAGES_PER_RUN) {
    const before = Date.now();
    const page = await transport.pull(cursor);
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

    pages++;
    cursor = page.cursor;
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
  const { pages, docs } = await pullAll(db, transport);
  await setMeta(db, "lastSyncAt", (options.now ?? Date.now)());
  return { pushed: sent, pages, pulled: docs };
}
