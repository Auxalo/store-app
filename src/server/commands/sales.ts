import { can } from "@/auth/permissions";
import type { CommandPayload } from "@/commands/definitions";
import { type EarlierReturn, returnedOf } from "@/lib/refund";
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
  // The prepare step (online sales) just read exactly these, in this same transaction.
  const prepared = ctx.scratch?.get(`products:${ids.slice().sort().join(",")}`);
  if (prepared) return prepared as Map<string, StoredDoc>;
  const found = await ctx.db
    .collection<StoredDoc>("products")
    .find(
      { _id: { $in: ids }, storeId: ctx.storeId, deletedAt: null },
      { session: ctx.session },
    )
    .toArray();
  return new Map(found.map((p) => [p._id, p]));
}

/**
 * Adds `direction * qty` to each product's stock. One product is one call; several are one bulk
 * write plus one read back (a cart of ten items used to be ten calls one after another, inside
 * the transaction). Returns the updated records, in the order given.
 */
async function moveStock(
  ctx: ServerCtx,
  products: Map<string, StoredDoc>,
  perProduct: Map<string, number>,
  direction: 1 | -1,
  nextSeq: () => number,
): Promise<WireChange[]> {
  const collection = ctx.db.collection<StoredDoc>("products");
  const change = (productId: string, qty: number) => {
    const product = products.get(productId) as StoredDoc;
    return {
      filter: { _id: productId, storeId: ctx.storeId },
      update: {
        $inc: { stock: direction * qty, version: 1 },
        $set: {
          syncSeq: nextSeq(),
          "fieldVersions.stock": product.version + 1,
          updatedAt: later(ctx.opCreatedAt, product.updatedAt),
        },
      },
    };
  };
  if (perProduct.size === 0) return [];
  if (perProduct.size === 1) {
    const [[productId, qty]] = [...perProduct];
    const { filter, update } = change(productId, qty);
    const updated = await collection.findOneAndUpdate(filter, update, {
      returnDocument: "after",
      session: ctx.session,
    });
    return [
      wire("products", updated ?? (products.get(productId) as StoredDoc)),
    ];
  }
  const entries = [...perProduct];
  await collection.bulkWrite(
    entries.map(([productId, qty]) => {
      const { filter, update } = change(productId, qty);
      return { updateOne: { filter, update } };
    }),
    { ordered: true, session: ctx.session },
  );
  const after = new Map(
    (
      await collection
        .find(
          { _id: { $in: entries.map(([id]) => id) }, storeId: ctx.storeId },
          { session: ctx.session },
        )
        .toArray()
    ).map((d) => [d._id, d]),
  );
  return entries.map(([productId]) =>
    wire(
      "products",
      after.get(productId) ?? (products.get(productId) as StoredDoc),
    ),
  );
}

async function liveCustomer(ctx: ServerCtx, id: string | null) {
  if (!id) return null;
  const prepared = ctx.scratch?.get(`customer:${id}`) as StoredDoc | undefined;
  if (prepared) return prepared.deletedAt == null ? prepared : null;
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

  const ids = [...new Set(p.lines.map((l) => l.productId))];
  const products = await liveProducts(ctx, ids);

  // A product that is not one of this shop's at all (made up, or another shop's) is refused, as
  // the online path does. One deleted a moment ago still sells, without moving stock.
  const absent = ids.filter((id) => !products.has(id));
  if (
    absent.length > 0 &&
    (await ctx.db
      .collection("products")
      .countDocuments({ _id: { $in: absent }, storeId: ctx.storeId } as never, {
        session: ctx.session,
      })) !== absent.length
  )
    return { status: "rejected", error: "NOT_FOUND" };

  // What an item is listed at and what it costs come from the shop's own records, never from the
  // device: otherwise a device could claim the list price was whatever it charged, and sell below
  // it without the price-override permission.
  const lines = p.lines.map((l) => {
    const product = products.get(l.productId);
    return product
      ? {
          ...l,
          listPrice: Number(product.sellingPrice ?? l.listPrice),
          unitCost: Number(product.purchasePrice ?? 0),
        }
      : l;
  });

  // A line sold at the price the item had until the owner changed it, on a sale rung up before
  // that change, was not an override: the cashier could not have known. It is honoured at the
  // price the customer was charged (the goods have left), and flagged for the owner below.
  const stale = new Set<number>();
  lines.forEach((l, index) => {
    const product = products.get(l.productId);
    if (
      product &&
      l.unitPrice !== l.listPrice &&
      product.previousSellingPrice === l.unitPrice &&
      typeof product.priceChangedAt === "string" &&
      product.priceChangedAt > ctx.opCreatedAt
    )
      stale.add(index);
  });
  for (const index of stale) lines[index].listPrice = lines[index].unitPrice;

  // Selling at a price other than the listed one needs its own permission.
  const overridden = lines.filter((l) => l.unitPrice !== l.listPrice);
  if (overridden.length > 0 && !can(ctx.role, "sale.priceOverride"))
    return { status: "rejected", error: "FORBIDDEN" };

  const totals = computeTotals(lines, p.discount, p.tendered);
  const customer =
    totals.due > 0 ? await liveCustomer(ctx, p.customerId) : null;
  const perProduct = qtyByProduct(
    lines.filter((l) => products.has(l.productId)),
  );
  const stockLines = lines
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
    itemCount: lines.length,
    items: lines.map((l, index) => ({
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

  docs.push(...(await moveStock(ctx, products, perProduct, -1, () => seq++)));

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

  if (stale.size > 0) {
    await writeAudit(ctx, {
      action: "sale.stalePrice",
      entity: "sale",
      entityId: p.id,
      newValue: [...stale].map((index) => ({
        productId: lines[index].productId,
        unitPrice: lines[index].unitPrice,
        currentPrice: products.get(lines[index].productId)?.sellingPrice,
      })),
    });
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

  // Goods already brought back by returns are in stock again, and money already taken off the
  // customer's due is not owed any more: cancelling the sale reverses only what is left.
  const earlierReturns = await ctx.db
    .collection<EarlierReturn>("returns")
    .find({ storeId: ctx.storeId, kind: "sale", refId: sale._id } as never, {
      session: ctx.session,
    })
    .toArray();
  const { restocked, credited } = returnedOf(earlierReturns);
  const dueLeft = Math.max(0, sale.due - credited);

  const products = await liveProducts(ctx, [
    ...new Set(sale.items.map((i) => i.productId)),
  ]);
  const stockItems = sale.items
    .map((item, index) => ({
      item,
      index,
      qty: item.qty - (restocked.get(index) ?? 0),
    }))
    .filter(({ item, qty }) => qty > 0 && products.has(item.productId));
  const perProduct = qtyByProduct(
    stockItems.map(({ item, qty }) => ({ productId: item.productId, qty })),
  );
  const customer =
    dueLeft > 0 ? await liveCustomer(ctx, sale.customerId) : null;

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
    const movements: StoredMovement[] = stockItems.map(
      ({ item, index, qty }) => ({
        _id: saleRecordIds.voidMovement(sale._id, index),
        storeId: ctx.storeId,
        productId: item.productId,
        type: "sale_return",
        qtyDelta: qty,
        note: sale.invoiceNo,
        refType: "sale_void",
        refId: sale._id,
        createdAt: ctx.opCreatedAt,
        updatedAt: ctx.opCreatedAt,
        createdBy: ctx.actorUserId,
        deviceId: ctx.deviceId,
        version: 1,
        syncSeq: seq++,
      }),
    );
    await ctx.db
      .collection<StoredMovement>("stockMovements")
      .insertMany(movements, { session: ctx.session });
    for (const m of movements) docs.push(wire("stockMovements", m));
  }

  docs.push(...(await moveStock(ctx, products, perProduct, 1, () => seq++)));

  if (customer) {
    const updated = await ctx.db
      .collection<StoredDoc>("customers")
      .findOneAndUpdate(
        { _id: customer._id, storeId: ctx.storeId },
        {
          $inc: { balance: -dueLeft, version: 1 },
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
      amountDelta: -dueLeft,
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
