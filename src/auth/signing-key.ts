"use client";

import { signOp } from "@/auth/op-proof";
import { getLocalDb } from "@/db/local/db";
import { useActiveUser } from "@/stores/active-user";
import { nudgeSync } from "@/sync/manager";

let inFlight: Promise<string | undefined> | undefined;

/**
 * Makes sure this tab can sign the work of the person working (see src/auth/op-proof.ts). A PIN
 * typed here already gives a key; otherwise (signed in with the password, or the PIN was typed in
 * another tab) the server hands out the key for this person on this device, if it knows they are
 * the one working here. Never throws: without a key, work is still saved and sent, and is signed
 * later when this person is known (see resignOwnOps).
 */
export async function ensureSigningKey(
  userId?: string,
  timeoutMs = 3_000,
): Promise<string | undefined> {
  const { proof } = useActiveUser.getState();
  if (proof && (!userId || proof.userId === userId)) return proof.key;
  if (typeof navigator !== "undefined" && !navigator.onLine) return undefined;
  inFlight ??= (async () => {
    try {
      const response = await fetch("/api/actor/key", {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { userId: string; key: string };
      useActiveUser.getState().setProof(body.userId, body.key);
      await resignOwnOps(body.userId, body.key);
      return body.userId === userId || !userId ? body.key : undefined;
    } catch {
      return undefined;
    } finally {
      inFlight = undefined;
    }
  })();
  const key = await inFlight;
  const now = useActiveUser.getState().proof;
  return now && (!userId || now.userId === userId) ? now.key : key;
}

/**
 * Work this person queued without a signature (a sale made before the key arrived, or one the
 * server refused for that reason) is signed now that they are known, and sent again. Work the
 * server refused is put back in the queue: it applies on the server and comes back down.
 */
export async function resignOwnOps(userId: string, key: string) {
  const db = getLocalDb();
  const ops = await db.outbox
    .filter(
      (op) =>
        op.actorUserId === userId &&
        !op.proof &&
        (op.status === "pending" ||
          (op.status === "failed" && op.lastError === "PROOF_REQUIRED")),
    )
    .toArray();
  if (ops.length === 0) return;
  await db.transaction("rw", db.outbox, async () => {
    for (const op of ops)
      await db.outbox.update(op.seq as number, {
        proof: signOp(key, {
          operationId: op.operationId,
          type: op.type,
          schemaVersion: op.schemaVersion,
          payload: op.payload,
          actorUserId: op.actorUserId,
          deviceId: op.deviceId,
          createdAt: op.createdAt,
        }),
        status: "pending",
        attempts: 0,
        nextAttemptAt: 0,
        lastError: undefined,
      });
  });
  nudgeSync();
}
