import { AUDIT_SETTING } from "@/lib/constants";
import { newId } from "@/lib/ids";
import type { ServerCtx } from "./commands/types";

export interface AuditEntry {
  action: string;
  entity: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
}

async function auditEnabled(ctx: ServerCtx): Promise<boolean> {
  const setting = await ctx.db
    .collection<{ _id: string; value?: unknown }>("settings")
    .findOne(
      { _id: `${ctx.storeId}:${AUDIT_SETTING}` },
      { session: ctx.session, projection: { value: 1 } },
    );
  return setting?.value === true;
}

/**
 * Records a sensitive action (spec §49), but only when the store has the audit log switched on: it
 * costs storage, so it is off by default. Written in the same transaction as the change itself, so
 * there is never a change without its audit line, or the reverse. Rows expire after 7 days.
 */
export async function writeAudit(
  ctx: ServerCtx,
  entry: AuditEntry,
): Promise<void> {
  if (!(await auditEnabled(ctx))) return;
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
