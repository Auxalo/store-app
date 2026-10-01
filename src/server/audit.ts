import { newId } from "@/lib/ids";
import type { ServerCtx } from "./commands/types";

export interface AuditEntry {
  action: string;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Records a sensitive action (spec §49). Written in the same transaction as the change itself,
 * so there is never a change without its audit line, or the reverse.
 */
export async function writeAudit(
  ctx: ServerCtx,
  entry: AuditEntry,
): Promise<void> {
  await ctx.db.collection<{ _id: string }>("auditLogs").insertOne(
    {
      _id: newId(),
      storeId: ctx.storeId,
      userId: ctx.actorUserId,
      deviceId: ctx.deviceId,
      ...entry,
      at: ctx.opCreatedAt,
      recordedAt: new Date(),
    } as never,
    { session: ctx.session },
  );
}
