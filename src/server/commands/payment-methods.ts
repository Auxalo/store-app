import type { CommandPayload } from "@/commands/definitions";
import { methodSettingKey } from "@/lib/payment-methods";
import { allocSeq } from "../sync/txn";
import type { ApplyResult, ServerCtx } from "./types";

interface StoredMethodSetting {
  _id: string;
  storeId: string;
  key: string;
  value: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  deviceId: string;
  deletedAt: string | null;
  syncSeq: number;
}

/**
 * Saves one of the shop's payment methods, the same way the device does (see
 * src/commands/local/payment-methods.ts): one settings record per method.
 */
export async function paymentMethodSave(
  ctx: ServerCtx,
  p: CommandPayload<"paymentMethod.save">,
): Promise<ApplyResult> {
  const key = methodSettingKey(p.code);
  const col = ctx.db.collection<StoredMethodSetting>("settings");
  const _id = `${ctx.storeId}:${key}`;
  const existing = await col.findOne({ _id }, { session: ctx.session });
  const wire = (doc: StoredMethodSetting): ApplyResult => ({
    status: "applied",
    docs: [{ collection: "settings", doc: { ...doc, id: key } as never }],
  });
  // Several people may save the same method: the most recent action wins.
  if (existing && ctx.opCreatedAt < existing.updatedAt) return wire(existing);

  const syncSeq = await allocSeq(ctx.db, ctx.session, ctx.storeId);
  const doc: StoredMethodSetting = {
    _id,
    storeId: ctx.storeId,
    key,
    value: { name: p.name, removed: p.removed },
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? ctx.opCreatedAt,
    updatedAt: ctx.opCreatedAt,
    updatedBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    deletedAt: null,
    syncSeq,
  };
  await col.replaceOne({ _id }, doc, { upsert: true, session: ctx.session });
  return wire(doc);
}
