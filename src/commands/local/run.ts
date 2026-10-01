import { can } from "@/auth/permissions";
import type { StoreDB } from "@/db/local/db";
import type { OutboxOp } from "@/db/local/types";
import { newId } from "@/lib/ids";
import {
  COMMANDS,
  type CommandInput,
  type CommandType,
  entityIdsOf,
  OP_SCHEMA_VERSION,
} from "../definitions";
import { PermissionError } from "../errors";
import { type LocalContext, localCommands } from "./registry";

type LocalHandler = (
  db: StoreDB,
  ctx: LocalContext,
  input: unknown,
  now: string,
) => Promise<unknown>;

/**
 * The only way the UI changes business data.
 *
 *   validate → check permission → ONE database transaction:
 *     { apply the change locally, queue the operation for the server }
 *
 * Because both writes share a transaction, a crash can never leave a change without its queued
 * operation (it would never sync) or an operation without its change. Nothing here waits for
 * the network; the caller should nudge the sync manager afterwards.
 */
export async function runCommand<T extends CommandType>(
  db: StoreDB,
  ctx: LocalContext,
  type: T,
  rawInput: CommandInput<T> | unknown,
): Promise<{ operationId: string }> {
  const def = COMMANDS[type];
  const input = def.input.parse(rawInput);
  if (!can(ctx.role, def.permission)) throw new PermissionError(def.permission);

  const now = new Date().toISOString();
  const operationId = newId();
  const handler = localCommands[type] as unknown as LocalHandler;

  await db.transaction("rw", db.tables, async () => {
    const payload = def.payload.parse(await handler(db, ctx, input, now));
    const op: OutboxOp = {
      operationId,
      type,
      collection: def.collection,
      entityId: entityIdsOf(type, payload)[0],
      entityIds: entityIdsOf(type, payload),
      schemaVersion: OP_SCHEMA_VERSION,
      payload,
      actorUserId: ctx.actorUserId,
      deviceId: ctx.deviceId,
      createdAt: now,
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
    };
    await db.outbox.add(op);
  });

  return { operationId };
}
