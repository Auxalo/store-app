import { can } from "@/auth/permissions";
import type { CommandPayload } from "@/commands/definitions";
import {
  computeTotals,
  lineAmount,
  qtyByProduct,
  saleRecordIds,
} from "@/lib/sale-math";
import { derivedSearchFields } from "@/lib/search-fields";
import type { WireChange } from "@/schemas/sync";
import { writeAudit } from "../audit";
import { allocSeq } from "../sync/txn";
import type { StoredDoc } from "./master-data";
import { toWire } from "./master-data";
import type { StoredMovement } from "./products";
import type { ApplyResult, ServerCtx } from "./types";

interface StoredSaleItem {
  id: string;
  productId: string;
  productName: string;
  productNameBn: string;
  unit: string;
  qty: number;
  listPrice: number;
  unitPrice: number;
  unitCost: number;
  discount: number;
  lineTotal: number;
}

interface StoredSale {
  _id: string;
  storeId: string;
  invoiceNo: string;
  customerId: string | null;
  customerName: string;
  customerPhone?: string;
  /** For searching on the server; devices work these out themselves. */
  searchWords?: string[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  due: number;
  paymentMethod: string;
  notes: string;
  status: "active" | "voided";
  itemCount: number;
  items: StoredSaleItem[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  version: number;
  deletedAt: string | null;
  voidedAt?: string | null;
  voidReason?: string;
  voidedBy?: string | null;
  syncSeq: number;
}

interface StoredLedger {
  _id: string;
  storeId: string;
  partyType: "customer";
  partyId: string;
  amountDelta: number;
  refType: string;
  refId: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  version: number;
  syncSeq: number;
}

const wire = (
  collection: WireChange["collection"],
  doc: unknown,
): WireChange => ({
  collection,
  doc: toWire(doc as StoredDoc),
});
const later = (a: string, b: string) => (a > b ? a : b);

/**
 * Products (by id) that still exist, so a sale of something deleted in the meantime is still
 * recorded (the goods did leave the shop) without trying to move stock that is not there.
 */
async function liveProducts(ctx: ServerCtx, ids: string[]) {
  const found = await ctx.db
    .collection<StoredDoc>("products")
    .find(
      { _id: { $in: ids }, storeId: ctx.storeId, deletedAt: null },
      { session: ctx.session },
    )
    .toArray();
  return new Map(found.map((p) => [p._id, p]));
}

async function liveCustomer(ctx: ServerCtx, id: string | null) {
  if (!id) return null;
  return ctx.db
    .collection<StoredDoc>("customers")
    .findOne(
      { _id: id, storeId: ctx.storeId, deletedAt: null },
      { session: ctx.session },
    );
}

/**
 * Applies a sale in one transaction: the sale, one stock movement per line, each product's stock,
 * and (when something is owed) the customer's balance plus its ledger entry. Totals are recomputed
 * here from the lines, never taken from the device.
 */
export async function saleCreate(
  ctx: ServerCtx,
  p: CommandPayload<"sale.create">,
): Promise<ApplyResult> {
  const sales = ctx.db.collection<StoredSale>("sales");
  const existing = await sales.findOne({ _id: p.id }, { session: ctx.session });
  if (existing) {
    return existing.storeId === ctx.storeId
      ? { status: "applied", docs: [wire("sales", existing)] }
      : { status: "rejected", error: "ID_COLLISION" };
  }

  // Selling at a price other than the listed one needs its own permission.
  const overridden = p.lines.filter((l) => l.unitPrice !== l.listPrice);
  if (overridden.length > 0 && !can(ctx.role, "sale.priceOverride"))
    return { status: "rejected", error: "FORBIDDEN" };

  const totals = computeTotals(p.lines, p.discount, p.tendered);
  const products = await liveProducts(ctx, [
    ...new Set(p.lines.map((l) => l.productId)),
  ]);
  const customer =
    totals.due > 0 ? await liveCustomer(ctx, p.customerId) : null;
  const perProduct = qtyByProduct(
    p.lines.filter((l) => products.has(l.productId)),
  );
  const stockLines = p.lines
    .map((l, index) => ({ l, index }))
    .filter(({ l }) => products.has(l.productId));

  // One sequence number per record written, reserved up front.
  const count = 1 + stockLines.length + perProduct.size + (customer ? 2 : 0);
  let seq = await allocSeq(ctx.db, ctx.session, ctx.storeId, count);
  const docs: WireChange[] = [];

  const sale: StoredSale = {
    _id: p.id,
    storeId: ctx.storeId,
    invoiceNo: p.invoiceNo,
    customerId: p.customerId,
    customerName: p.customerName,
    customerPhone: p.customerPhone,
    ...derivedSearchFields("sales", {
      invoiceNo: p.invoiceNo,
      customerName: p.customerName,
      customerPhone: p.customerPhone,
    }),
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    paid: totals.paid,
    due: totals.due,
    paymentMethod: p.paymentMethod,
    notes: p.notes,
    status: "active",
    itemCount: p.lines.length,
    items: p.lines.map((l, index) => ({
      id: saleRecordIds.item(p.id, index),
      productId: l.productId,
      productName: l.productName,
      productNameBn: l.productNameBn,
      unit: l.unit,
      qty: l.qty,
      listPrice: l.listPrice,
      unitPrice: l.unitPrice,
      unitCost: l.unitCost,
      discount: l.discount,
      lineTotal: lineAmount(l),
    })),
    createdAt: ctx.opCreatedAt,
    updatedAt: ctx.opCreatedAt,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
    deletedAt: null,
    syncSeq: seq++,
  };
  await sales.insertOne(sale, { session: ctx.session });
  docs.push(wire("sales", sale));

  if (stockLines.length > 0) {
    const movements: StoredMovement[] = stockLines.map(({ l, index }) => ({
      _id: saleRecordIds.movement(p.id, index),
      storeId: ctx.storeId,
      productId: l.productId,
      type: "sale",
      qtyDelta: -l.qty,
      note: "",
      refType: "sale",
      refId: p.id,
      createdAt: ctx.opCreatedAt,
      updatedAt: ctx.opCreatedAt,
      createdBy: ctx.actorUserId,
      deviceId: ctx.deviceId,
      version: 1,
      syncSeq: seq++,
    }));
    await ctx.db
      .collection<StoredMovement>("stockMovements")
      .insertMany(movements, { session: ctx.session });
    for (const m of movements) docs.push(wire("stockMovements", m));
  }

  for (const [productId, qty] of perProduct) {
    const product = products.get(productId) as StoredDoc;
    const updated = await ctx.db
      .collection<StoredDoc>("products")
      .findOneAndUpdate(
        { _id: productId, storeId: ctx.storeId },
        {
          $inc: { stock: -qty, version: 1 },
          $set: {
            syncSeq: seq++,
            "fieldVersions.stock": product.version + 1,
            updatedAt: later(ctx.opCreatedAt, product.updatedAt),
          },
        },
        { returnDocument: "after", session: ctx.session },
      );
    docs.push(wire("products", updated ?? product));
  }

  if (customer) {
    const updated = await ctx.db
      .collection<StoredDoc>("customers")
      .findOneAndUpdate(
        { _id: customer._id, storeId: ctx.storeId },
        {
          $inc: { balance: totals.due, version: 1 },
          $set: {
            syncSeq: seq++,
            "fieldVersions.balance": customer.version + 1,
            updatedAt: later(ctx.opCreatedAt, customer.updatedAt),
          },
        },
        { returnDocument: "after", session: ctx.session },
      );
    docs.push(wire("customers", updated ?? customer));

    const entry: StoredLedger = {
      _id: saleRecordIds.ledger(p.id),
      storeId: ctx.storeId,
      partyType: "customer",
      partyId: customer._id,
      amountDelta: totals.due,
      refType: "sale",
      refId: p.id,
      note: p.invoiceNo,
      createdAt: ctx.opCreatedAt,
      updatedAt: ctx.opCreatedAt,
      createdBy: ctx.actorUserId,
      deviceId: ctx.deviceId,
      version: 1,
      syncSeq: seq++,
    };
    await ctx.db
      .collection<StoredLedger>("ledgerEntries")
      .insertOne(entry, { session: ctx.session });
    docs.push(wire("ledgerEntries", entry));
  }

  if (overridden.length > 0) {
    await writeAudit(ctx, {
      action: "sale.priceOverride",
      entity: "sale",
      entityId: p.id,
      newValue: overridden.map((l) => ({
        productId: l.productId,
        listPrice: l.listPrice,
        unitPrice: l.unitPrice,
      })),
    });
  }
  return { status: "applied", docs };
}

/** Cancels a sale by adding reversing records, never by editing or deleting history. */
export async function saleVoid(
  ctx: ServerCtx,
  p: CommandPayload<"sale.void">,
): Promise<ApplyResult> {
  const sales = ctx.db.collection<StoredSale>("sales");
  const sale = await sales.findOne(
    { _id: p.saleId, storeId: ctx.storeId },
    { session: ctx.session },
  );
  if (!sale) return { status: "rejected", error: "NOT_FOUND" };
  if (sale.status === "voided")
    return { status: "applied", docs: [wire("sales", sale)] }; // already done

  const products = await liveProducts(ctx, [
    ...new Set(sale.items.map((i) => i.productId)),
  ]);
  const stockItems = sale.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => products.has(item.productId));
  const perProduct = qtyByProduct(stockItems.map(({ item }) => item));
  const customer =
    sale.due > 0 ? await liveCustomer(ctx, sale.customerId) : null;

  const count = 1 + stockItems.length + perProduct.size + (customer ? 2 : 0);
  let seq = await allocSeq(ctx.db, ctx.session, ctx.storeId, count);
  const docs: WireChange[] = [];

  const voided = await sales.findOneAndUpdate(
    { _id: sale._id, storeId: ctx.storeId },
    {
      $inc: { version: 1 },
      $set: {
        status: "voided",
        voidedAt: ctx.opCreatedAt,
        voidReason: p.reason,
        voidedBy: ctx.actorUserId,
        syncSeq: seq++,
        updatedAt: later(ctx.opCreatedAt, sale.updatedAt),
      },
    },
    { returnDocument: "after", session: ctx.session },
  );
  docs.push(wire("sales", voided ?? sale));

  if (stockItems.length > 0) {
    const movements: StoredMovement[] = stockItems.map(({ item, index }) => ({
      _id: saleRecordIds.voidMovement(sale._id, index),
      storeId: ctx.storeId,
      productId: item.productId,
      type: "sale_return",
      qtyDelta: item.qty,
      note: sale.invoiceNo,
      refType: "sale_void",
      refId: sale._id,
      createdAt: ctx.opCreatedAt,
      updatedAt: ctx.opCreatedAt,
      createdBy: ctx.actorUserId,
      deviceId: ctx.deviceId,
      version: 1,
      syncSeq: seq++,
    }));
    await ctx.db
      .collection<StoredMovement>("stockMovements")
      .insertMany(movements, { session: ctx.session });
    for (const m of movements) docs.push(wire("stockMovements", m));
  }

  for (const [productId, qty] of perProduct) {
    const product = products.get(productId) as StoredDoc;
    const updated = await ctx.db
      .collection<StoredDoc>("products")
      .findOneAndUpdate(
        { _id: productId, storeId: ctx.storeId },
        {
          $inc: { stock: qty, version: 1 },
          $set: {
            syncSeq: seq++,
            "fieldVersions.stock": product.version + 1,
            updatedAt: later(ctx.opCreatedAt, product.updatedAt),
          },
        },
        { returnDocument: "after", session: ctx.session },
      );
    docs.push(wire("products", updated ?? product));
  }

  if (customer) {
    const updated = await ctx.db
      .collection<StoredDoc>("customers")
      .findOneAndUpdate(
        { _id: customer._id, storeId: ctx.storeId },
        {
          $inc: { balance: -sale.due, version: 1 },
          $set: {
            syncSeq: seq++,
            "fieldVersions.balance": customer.version + 1,
            updatedAt: later(ctx.opCreatedAt, customer.updatedAt),
          },
        },
        { returnDocument: "after", session: ctx.session },
      );
    docs.push(wire("customers", updated ?? customer));

    const entry: StoredLedger = {
      _id: saleRecordIds.voidLedger(sale._id),
      storeId: ctx.storeId,
      partyType: "customer",
      partyId: customer._id,
      amountDelta: -sale.due,
      refType: "sale_void",
      refId: sale._id,
      note: sale.invoiceNo,
      createdAt: ctx.opCreatedAt,
      updatedAt: ctx.opCreatedAt,
      createdBy: ctx.actorUserId,
      deviceId: ctx.deviceId,
      version: 1,
      syncSeq: seq++,
    };
    await ctx.db
      .collection<StoredLedger>("ledgerEntries")
      .insertOne(entry, { session: ctx.session });
    docs.push(wire("ledgerEntries", entry));
  }

  await writeAudit(ctx, {
    action: "sale.void",
    entity: "sale",
    entityId: sale._id,
    oldValue: { status: "active", total: sale.total },
    newValue: { status: "voided", reason: p.reason },
  });
  return { status: "applied", docs };
}
