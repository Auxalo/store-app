import type { CommandPayload } from "@/commands/definitions";
import { derivedSearchFields } from "@/lib/search-fields";
import { PRODUCT_CRITICAL_FIELDS } from "@/schemas/product";
import type { WireChange } from "@/schemas/sync";
import { writeAudit } from "../audit";
import { allocSeq } from "../sync/txn";
import { type MasterConfig, type StoredDoc, toWire } from "./master-data";
import type { ApplyResult, ServerCtx } from "./types";

export const productConfig: MasterConfig = {
  collection: "products",
  criticalFields: PRODUCT_CRITICAL_FIELDS,
  derive: (doc) => derivedSearchFields("products", doc),
};

export interface StoredMovement {
  _id: string;
  storeId: string;
  productId: string;
  type: string;
  qtyDelta: number;
  note: string;
  refType: string | null;
  refId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  version: number;
  syncSeq: number;
}

const productChange = (doc: StoredDoc): WireChange => ({
  collection: "products",
  doc: toWire(doc),
});
const movementChange = (m: StoredMovement): WireChange => ({
  collection: "stockMovements",
  doc: toWire(m as unknown as StoredDoc),
});

function newMovement(
  ctx: ServerCtx,
  m: {
    id: string;
    productId: string;
    type: string;
    qtyDelta: number;
    note: string;
    syncSeq: number;
  },
): StoredMovement {
  return {
    _id: m.id,
    storeId: ctx.storeId,
    productId: m.productId,
    type: m.type,
    qtyDelta: m.qtyDelta,
    note: m.note,
    refType: null,
    refId: null,
    createdAt: ctx.opCreatedAt,
    updatedAt: ctx.opCreatedAt,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
    syncSeq: m.syncSeq,
  };
}

export async function productCreate(
  ctx: ServerCtx,
  payload: CommandPayload<"product.create">,
): Promise<ApplyResult> {
  const { id, openingStock, openingMovementId, ...fields } = payload;
  const products = ctx.db.collection<StoredDoc>("products");
  const movements = ctx.db.collection<StoredMovement>("stockMovements");

  const existing = await products.findOne(
    { _id: id },
    { session: ctx.session },
  );
  if (existing) {
    if (existing.storeId !== ctx.storeId)
      return { status: "rejected", error: "ID_COLLISION" };
    return { status: "applied", docs: [productChange(existing)] };
  }

  const withMovement = openingStock !== 0;
  const first = await allocSeq(
    ctx.db,
    ctx.session,
    ctx.storeId,
    withMovement ? 2 : 1,
  );
  const doc: StoredDoc = {
    ...fields,
    _id: id,
    storeId: ctx.storeId,
    stock: openingStock,
    version: 1,
    fieldVersions: Object.fromEntries(
      [...Object.keys(fields), "stock"].map((f) => [f, 1]),
    ),
    createdAt: ctx.opCreatedAt,
    updatedAt: ctx.opCreatedAt,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    deletedAt: null,
    syncSeq: first,
  };
  Object.assign(doc, derivedSearchFields("products", doc));
  await products.insertOne(doc, { session: ctx.session });

  const docs = [productChange(doc)];
  if (withMovement) {
    const movement = newMovement(ctx, {
      id: openingMovementId,
      productId: id,
      type: "opening",
      qtyDelta: openingStock,
      note: "",
      syncSeq: first + 1,
    });
    await movements.insertOne(movement, { session: ctx.session });
    docs.push(movementChange(movement));
  }
  return { status: "applied", docs };
}

/**
 * Adds a movement to the ledger and moves the product's stock by the same delta, atomically.
 * Stock is only ever changed with $inc, never overwritten, so two devices adjusting the same
 * product offline add up instead of one erasing the other.
 */
export async function stockAdjust(
  ctx: ServerCtx,
  payload: CommandPayload<"stock.adjust">,
): Promise<ApplyResult> {
  const products = ctx.db.collection<StoredDoc>("products");
  const movements = ctx.db.collection<StoredMovement>("stockMovements");

  const product = await products.findOne(
    { _id: payload.productId, storeId: ctx.storeId },
    { session: ctx.session },
  );
  if (!product) return { status: "rejected", error: "NOT_FOUND" };
  if (product.deletedAt)
    return {
      status: "rejected",
      error: "DELETED",
      docs: [productChange(product)],
    };

  const already = await movements.findOne(
    { _id: payload.movementId },
    { session: ctx.session },
  );
  // An id that belongs to another shop is a clash, never an answer: nothing of theirs is returned.
  if (already && already.storeId !== ctx.storeId)
    return { status: "rejected", error: "ID_COLLISION" };
  if (already)
    return {
      status: "applied",
      docs: [productChange(product), movementChange(already)],
    };

  const first = await allocSeq(ctx.db, ctx.session, ctx.storeId, 2);
  const movement = newMovement(ctx, {
    id: payload.movementId,
    productId: payload.productId,
    type: payload.type,
    qtyDelta: payload.qtyDelta,
    note: payload.note,
    syncSeq: first + 1,
  });
  await movements.insertOne(movement, { session: ctx.session });

  const updated = await products.findOneAndUpdate(
    { _id: payload.productId, storeId: ctx.storeId },
    {
      $inc: { stock: payload.qtyDelta, version: 1 },
      $set: {
        syncSeq: first,
        "fieldVersions.stock": product.version + 1,
        updatedAt:
          ctx.opCreatedAt > product.updatedAt
            ? ctx.opCreatedAt
            : product.updatedAt,
      },
    },
    { returnDocument: "after", session: ctx.session },
  );

  await writeAudit(ctx, {
    action: "stock.adjust",
    entity: "product",
    entityId: payload.productId,
    oldValue: { stock: product.stock },
    newValue: {
      stock: product.stock + payload.qtyDelta,
      type: payload.type,
      note: payload.note,
    },
  });
  return {
    status: "applied",
    docs: [productChange(updated ?? product), movementChange(movement)],
  };
}
