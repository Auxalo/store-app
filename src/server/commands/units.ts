import type { CommandPayload } from "@/commands/definitions";
import { unitSettingKey } from "@/lib/units";
import { allocSeq } from "../sync/txn";
import type { ApplyResult, ServerCtx } from "./types";

interface StoredUnitSetting {
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
 * Saves one of the shop's units, the same way the device does (see src/commands/local/units.ts):
 * one settings record per unit, and a unit that a live product still uses cannot be removed.
 */
export async function unitSave(
  ctx: ServerCtx,
  p: CommandPayload<"unit.save">,
): Promise<ApplyResult> {
  const key = unitSettingKey(p.code);
  const col = ctx.db.collection<StoredUnitSetting>("settings");
  const _id = `${ctx.storeId}:${key}`;
  const existing = await col.findOne({ _id }, { session: ctx.session });
  const wire = (doc: StoredUnitSetting): ApplyResult => ({
    status: "applied",
    docs: [{ collection: "settings", doc: { ...doc, id: key } as never }],
  });
  // Several people may save the same unit: the most recent action wins.
  if (existing && ctx.opCreatedAt < existing.updatedAt) return wire(existing);

  if (p.removed) {
    const inUse = await ctx.db
      .collection("products")
      .countDocuments(
        { storeId: ctx.storeId, deletedAt: null, unit: p.code },
        { session: ctx.session, limit: 1 },
      );
    if (inUse > 0) return { status: "rejected", error: "UNIT_IN_USE" };
  }

  const syncSeq = await allocSeq(ctx.db, ctx.session, ctx.storeId);
  const doc: StoredUnitSetting = {
    _id,
    storeId: ctx.storeId,
    key,
    value: { name: p.name, decimals: p.decimals, removed: p.removed },
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
