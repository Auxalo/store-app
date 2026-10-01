import type { Role } from "@/auth/permissions";
import type { StoreDB } from "@/db/local/db";
import { searchWords } from "@/lib/search";
import type { CommandInput, CommandPayload, CommandType } from "../definitions";
import { AlreadyExistsError, NotFoundError } from "../errors";
import {
  expenseCreate,
  expenseVoid,
  paymentCreate,
  purchaseCreate,
  purchaseReturnCreate,
  saleReturnCreate,
  supplierCreate,
  supplierDelete,
  supplierUpdate,
} from "./purchasing";
import {
  customerCreate,
  customerDelete,
  customerUpdate,
  saleCreate,
  saleVoid,
} from "./sales";

export interface LocalContext {
  storeId: string;
  actorUserId: string;
  role: Role;
  deviceId: string;
}

/**
 * Applies a command's effect to the device database and returns the payload to queue.
 * Runs inside the same transaction as the queue write, so both happen or neither does.
 */
type LocalHandler<T extends CommandType> = (
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<T>,
  now: string,
) => Promise<CommandPayload<T>>;

export const localCommands: { [T in CommandType]: LocalHandler<T> } = {
  "category.create": async (db, ctx, input, now) => {
    if (await db.categories.get(input.id))
      throw new AlreadyExistsError("category");
    await db.categories.add({
      ...input,
      storeId: ctx.storeId,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.actorUserId,
      deviceId: ctx.deviceId,
      version: 1,
      deletedAt: null,
    });
    return input;
  },

  "category.update": async (db, _ctx, input, now) => {
    const doc = await db.categories.get(input.id);
    if (!doc || doc.deletedAt) throw new NotFoundError("category");
    await db.categories.update(input.id, {
      ...input.changes,
      version: doc.version + 1,
      updatedAt: now,
    });
    return { ...input, baseVersion: doc.version };
  },

  "category.delete": async (db, _ctx, input, now) => {
    const doc = await db.categories.get(input.id);
    if (!doc || doc.deletedAt) throw new NotFoundError("category");
    await db.categories.update(input.id, {
      deletedAt: now,
      version: doc.version + 1,
      updatedAt: now,
    });
    return { ...input, baseVersion: doc.version };
  },

  "product.create": async (db, ctx, input, now) => {
    if (await db.products.get(input.id))
      throw new AlreadyExistsError("product");
    const { openingStock, openingMovementId, ...product } = input;
    await db.products.add({
      ...product,
      stock: openingStock,
      storeId: ctx.storeId,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.actorUserId,
      deviceId: ctx.deviceId,
      version: 1,
      deletedAt: null,
      searchWords: searchWords(
        product.name,
        product.nameBn,
        product.sku,
        product.barcode,
      ),
    });
    if (openingStock !== 0) {
      await db.stockMovements.add({
        id: openingMovementId,
        storeId: ctx.storeId,
        productId: product.id,
        type: "opening",
        qtyDelta: openingStock,
        note: "",
        createdAt: now,
        createdBy: ctx.actorUserId,
        deviceId: ctx.deviceId,
      });
    }
    return input;
  },

  "product.update": async (db, _ctx, input, now) => {
    const doc = await db.products.get(input.id);
    if (!doc || doc.deletedAt) throw new NotFoundError("product");
    const next = { ...doc, ...input.changes };
    await db.products.update(input.id, {
      ...input.changes,
      searchWords: searchWords(next.name, next.nameBn, next.sku, next.barcode),
      version: doc.version + 1,
      updatedAt: now,
    });
    return { ...input, baseVersion: doc.version };
  },

  "product.delete": async (db, _ctx, input, now) => {
    const doc = await db.products.get(input.id);
    if (!doc || doc.deletedAt) throw new NotFoundError("product");
    await db.products.update(input.id, {
      deletedAt: now,
      version: doc.version + 1,
      updatedAt: now,
    });
    return { ...input, baseVersion: doc.version };
  },

  "stock.adjust": async (db, ctx, input, now) => {
    const doc = await db.products.get(input.productId);
    if (!doc || doc.deletedAt) throw new NotFoundError("product");
    if (await db.stockMovements.get(input.movementId))
      throw new AlreadyExistsError("movement");
    await db.products.update(input.productId, {
      stock: doc.stock + input.qtyDelta,
      version: doc.version + 1,
      updatedAt: now,
    });
    await db.stockMovements.add({
      id: input.movementId,
      storeId: ctx.storeId,
      productId: input.productId,
      type: input.type,
      qtyDelta: input.qtyDelta,
      note: input.note,
      createdAt: now,
      createdBy: ctx.actorUserId,
      deviceId: ctx.deviceId,
    });
    return input;
  },

  "customer.create": (db, ctx, input, now) =>
    customerCreate(db, ctx, input, now),
  "customer.update": (db, _ctx, input, now) => customerUpdate(db, input, now),
  "customer.delete": (db, _ctx, input, now) => customerDelete(db, input, now),
  "sale.create": (db, ctx, input, now) => saleCreate(db, ctx, input, now),
  "sale.void": (db, ctx, input, now) => saleVoid(db, ctx, input, now),

  "supplier.create": (db, ctx, input, now) =>
    supplierCreate(db, ctx, input, now),
  "supplier.update": (db, _ctx, input, now) => supplierUpdate(db, input, now),
  "supplier.delete": (db, _ctx, input, now) => supplierDelete(db, input, now),
  "purchase.create": (db, ctx, input, now) =>
    purchaseCreate(db, ctx, input, now),
  "payment.collect": (db, ctx, input, now) =>
    paymentCreate(db, ctx, "customer", input, now),
  "payment.pay": (db, ctx, input, now) =>
    paymentCreate(db, ctx, "supplier", input, now),
  "expense.create": (db, ctx, input, now) => expenseCreate(db, ctx, input, now),
  "expense.void": (db, _ctx, input, now) => expenseVoid(db, input, now),
  "saleReturn.create": (db, ctx, input, now) =>
    saleReturnCreate(db, ctx, input, now),
  "purchaseReturn.create": (db, ctx, input, now) =>
    purchaseReturnCreate(db, ctx, input, now),

  "setting.set": async (db, ctx, input, now) => {
    const existing = await db.settings.get(input.key);
    await db.settings.put({
      id: input.key,
      key: input.key,
      value: input.value,
      storeId: ctx.storeId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      updatedBy: ctx.actorUserId,
      deviceId: ctx.deviceId,
      version: (existing?.version ?? 0) + 1,
      deletedAt: null,
      syncSeq: existing?.syncSeq,
    });
    return { ...input, baseVersion: existing?.version ?? 0 };
  },
};
