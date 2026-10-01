import type { CommandType } from "@/commands/definitions";
import { writeAudit } from "../audit";
import { allocSeq } from "../sync/txn";
import {
  type MasterConfig,
  masterCreate,
  masterDelete,
  masterUpdate,
} from "./master-data";
import { productConfig, productCreate, stockAdjust } from "./products";
import type { ApplyResult, ServerHandler } from "./types";

const categories: MasterConfig = {
  collection: "categories",
  criticalFields: [],
};

interface StoredSetting {
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
 * One handler per command (the key set is checked against COMMANDS by the compiler).
 * Handlers validate before they write so a conflict or rejection never leaves partial changes.
 */
export const serverCommands: { [T in CommandType]: ServerHandler<T> } = {
  "category.create": (ctx, { id, ...fields }) =>
    masterCreate(ctx, categories, id, fields),
  "category.update": (ctx, { id, baseVersion, changes }) =>
    masterUpdate(ctx, categories, id, baseVersion, changes),
  "category.delete": (ctx, { id }) => masterDelete(ctx, categories, id),

  "product.create": (ctx, payload) => productCreate(ctx, payload),
  "product.update": (ctx, { id, baseVersion, changes }) =>
    masterUpdate(
      ctx,
      productConfig,
      id,
      baseVersion,
      changes,
      async (before, applied) => {
        for (const field of ["purchasePrice", "sellingPrice"] as const) {
          if (field in applied && applied[field] !== before[field]) {
            await writeAudit(ctx, {
              action: "product.priceChange",
              entity: "product",
              entityId: id,
              oldValue: { [field]: before[field] },
              newValue: { [field]: applied[field] },
            });
          }
        }
      },
    ),
  "product.delete": (ctx, { id }) => masterDelete(ctx, productConfig, id),
  "stock.adjust": (ctx, payload) => stockAdjust(ctx, payload),

  // Settings are tiny key/value records: the most recent action wins.
  "setting.set": async (ctx, { key, value }): Promise<ApplyResult> => {
    const col = ctx.db.collection<StoredSetting>("settings");
    const _id = `${ctx.storeId}:${key}`;
    const existing = await col.findOne({ _id }, { session: ctx.session });
    const wire = (doc: StoredSetting): ApplyResult => ({
      status: "applied",
      docs: [{ collection: "settings", doc: { ...doc, id: key } as never }],
    });
    if (existing && ctx.opCreatedAt < existing.updatedAt) return wire(existing);

    const syncSeq = await allocSeq(ctx.db, ctx.session, ctx.storeId);
    const doc: StoredSetting = {
      _id,
      storeId: ctx.storeId,
      key,
      value,
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
  },
};
