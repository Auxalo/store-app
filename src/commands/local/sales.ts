import type { StoreDB } from "@/db/local/db";
import { getMeta, setMeta } from "@/db/local/meta";
import { yearMonth } from "@/lib/doc-number";
import {
  computeTotals,
  lineAmount,
  qtyByProduct,
  saleRecordIds,
} from "@/lib/sale-math";
import { derivedSearchFields } from "@/lib/search-fields";
import type { CommandInput, CommandPayload } from "../definitions";
import { AlreadyExistsError, ConflictError, NotFoundError } from "../errors";
import type { LocalContext } from "./registry";

/**
 * Document numbers look like "A-2610-0042": the device's code, the month, and a counter that only
 * this device uses. Two devices selling offline can therefore never issue the same number, with
 * no coordination. The counter is bumped in the same transaction as the document itself.
 * `prefix` separates other documents ("P" purchases, "R" returns) into their own series.
 */
export async function nextDocNo(
  db: StoreDB,
  deviceId: string,
  now: string,
  prefix = "",
): Promise<string> {
  // Until the server has given this device a short code, use the random end of its id. (The start
  // of a time-ordered id is the same for devices created around the same time, which made their
  // invoice numbers collide.)
  const code =
    (await getMeta(db, "deviceCode")) ??
    deviceId.replaceAll("-", "").slice(-4).toUpperCase();
  const month = yearMonth(now);
  const key = `${prefix}${month}`;
  const counters = (await getMeta(db, "invoiceSeq")) ?? {};
  const seq = (counters[key] ?? 0) + 1;
  await setMeta(db, "invoiceSeq", { ...counters, [key]: seq });
  return `${prefix ? `${prefix}-` : ""}${code}-${month}-${String(seq).padStart(4, "0")}`;
}

export const nextInvoiceNo = (db: StoreDB, deviceId: string, now: string) =>
  nextDocNo(db, deviceId, now);

const customerFields = (c: object) =>
  derivedSearchFields("customers", c as Record<string, unknown>);

export async function customerCreate(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"customer.create">,
  now: string,
) {
  if (await db.customers.get(input.id))
    throw new AlreadyExistsError("customer");
  await db.customers.add({
    ...input,
    balance: 0,
    storeId: ctx.storeId,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
    deletedAt: null,
    ...customerFields(input),
  });
  return input;
}

export async function customerUpdate(
  db: StoreDB,
  input: CommandInput<"customer.update">,
  now: string,
) {
  const doc = await db.customers.get(input.id);
  if (!doc || doc.deletedAt) throw new NotFoundError("customer");
  const next = { ...doc, ...input.changes };
  await db.customers.update(input.id, {
    ...input.changes,
    ...customerFields(next),
    version: doc.version + 1,
    updatedAt: now,
  });
  return { ...input, baseVersion: doc.version };
}

export async function customerDelete(
  db: StoreDB,
  input: CommandInput<"customer.delete">,
  now: string,
) {
  const doc = await db.customers.get(input.id);
  if (!doc || doc.deletedAt) throw new NotFoundError("customer");
  if (doc.balance !== 0) throw new Error("HAS_BALANCE");
  await db.customers.update(input.id, {
    deletedAt: now,
    version: doc.version + 1,
    updatedAt: now,
  });
  return { ...input, baseVersion: doc.version };
}

/** Moves a product's stock and records the movement, if the product still exists on this device. */
async function moveStock(
  db: StoreDB,
  productId: string,
  delta: number,
  now: string,
) {
  const product = await db.products.get(productId);
  if (!product || product.deletedAt) return false;
  await db.products.update(productId, {
    stock: product.stock + delta,
    version: product.version + 1,
    updatedAt: now,
  });
  return true;
}

export async function saleCreate(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"sale.create">,
  now: string,
): Promise<CommandPayload<"sale.create">> {
  if (await db.sales.get(input.id)) throw new AlreadyExistsError("sale");

  const invoiceNo = await nextInvoiceNo(db, ctx.deviceId, now);
  // Store credit can only pay what the customer really has paid ahead.
  const payer = input.customerId
    ? await db.customers.get(input.customerId)
    : undefined;
  const credit = payer && !payer.deletedAt ? Math.max(0, -payer.balance) : 0;
  const totals = computeTotals(
    input.lines,
    input.discount,
    input.tendered,
    Math.min(input.creditUsed, credit),
  );

  // Lines: a snapshot of what was sold, and (when the product still exists) the stock leaving.
  const live = new Set<string>();
  for (const productId of new Set(input.lines.map((l) => l.productId))) {
    const product = await db.products.get(productId);
    if (product && !product.deletedAt) live.add(productId);
  }
  await db.saleItems.bulkAdd(
    input.lines.map((line, index) => ({
      id: saleRecordIds.item(input.id, index),
      saleId: input.id,
      productId: line.productId,
      productName: line.productName,
      productNameBn: line.productNameBn,
      unit: line.unit,
      qty: line.qty,
      listPrice: line.listPrice,
      unitPrice: line.unitPrice,
      unitCost: line.unitCost,
      discount: line.discount,
      lineTotal: lineAmount(line),
      createdAt: now,
    })),
  );
  await db.stockMovements.bulkAdd(
    input.lines.flatMap((line, index) =>
      live.has(line.productId)
        ? [
            {
              id: saleRecordIds.movement(input.id, index),
              storeId: ctx.storeId,
              productId: line.productId,
              type: "sale" as const,
              qtyDelta: -line.qty,
              note: "",
              refType: "sale",
              refId: input.id,
              createdAt: now,
              createdBy: ctx.actorUserId,
              deviceId: ctx.deviceId,
            },
          ]
        : [],
    ),
  );
  for (const [productId, qty] of qtyByProduct(input.lines)) {
    if (live.has(productId)) await moveStock(db, productId, -qty, now);
  }

  // Whatever was not paid becomes the customer's due, and store credit that paid for it is used
  // up: both move the balance up, and both are one ledger entry.
  const owed = totals.due + totals.creditUsed;
  if (owed > 0 && input.customerId) {
    const customer = await db.customers.get(input.customerId);
    if (customer && !customer.deletedAt) {
      await db.customers.update(customer.id, {
        balance: customer.balance + owed,
        version: customer.version + 1,
        updatedAt: now,
      });
      await db.ledgerEntries.add({
        id: saleRecordIds.ledger(input.id),
        storeId: ctx.storeId,
        partyType: "customer",
        partyId: customer.id,
        amountDelta: owed,
        refType: "sale",
        refId: input.id,
        note: invoiceNo,
        createdAt: now,
        updatedAt: now,
        createdBy: ctx.actorUserId,
        deviceId: ctx.deviceId,
        version: 1,
      });
    }
  }

  // The buyer's phone is kept on the sale, so the sale can be found by it later.
  const buyer = input.customerId
    ? await db.customers.get(input.customerId)
    : undefined;
  const customerPhone = buyer?.phone ?? "";
  await db.sales.add({
    id: input.id,
    storeId: ctx.storeId,
    invoiceNo,
    customerId: input.customerId,
    customerName: input.customerName,
    customerPhone,
    ...derivedSearchFields("sales", {
      invoiceNo,
      customerName: input.customerName,
      customerPhone,
    }),
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    creditUsed: totals.creditUsed,
    tendered: input.tendered,
    paid: totals.paid,
    due: totals.due,
    paymentMethod: input.paymentMethod,
    notes: input.notes,
    status: "active",
    itemCount: input.lines.length,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
    deletedAt: null,
  });

  return { ...input, creditUsed: totals.creditUsed, invoiceNo, customerPhone };
}

/** Cancelling a sale never edits it: it adds reversing movements and ledger entries and flags the sale. */
export async function saleVoid(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"sale.void">,
  now: string,
): Promise<CommandPayload<"sale.void">> {
  const sale = await db.sales.get(input.saleId);
  if (!sale) throw new NotFoundError("sale");
  if (sale.status === "voided") throw new AlreadyExistsError("void");
  const items = await db.saleItems.where("saleId").equals(sale.id).sortBy("id");
  // Same order as when the sale was created, so reversal ids line up with the server's.
  const ordered = items.sort(
    (a, b) => Number(a.id.split(":i")[1]) - Number(b.id.split(":i")[1]),
  );

  // Goods already brought back by returns are in stock again, and money already taken off the
  // customer's due is not owed any more: cancelling the sale reverses only what is left.
  // Once anything has come back, the rest also comes back as a return (it keeps stock, dues and
  // cash right and every figure in the reports adding up); a cancellation would reverse it twice.
  const earlierReturns = await db.returns
    .where("refId")
    .equals(sale.id)
    .filter((r) => r.kind === "sale")
    .toArray();
  if (earlierReturns.length > 0) throw new ConflictError("HAS_RETURNS");
  const left = ordered.map((item) => ({
    productId: item.productId,
    qty: item.qty,
  }));
  // What the sale put on the customer's balance: its due, and the store credit it used up.
  const dueLeft = sale.due + (sale.creditUsed ?? 0);

  const live = new Set<string>();
  for (const productId of new Set(ordered.map((i) => i.productId))) {
    const product = await db.products.get(productId);
    if (product && !product.deletedAt) live.add(productId);
  }
  await db.stockMovements.bulkAdd(
    ordered.flatMap((item, index) =>
      live.has(item.productId) && left[index].qty > 0
        ? [
            {
              id: saleRecordIds.voidMovement(sale.id, index),
              storeId: ctx.storeId,
              productId: item.productId,
              type: "sale_return" as const,
              qtyDelta: left[index].qty,
              note: sale.invoiceNo,
              refType: "sale_void",
              refId: sale.id,
              createdAt: now,
              createdBy: ctx.actorUserId,
              deviceId: ctx.deviceId,
            },
          ]
        : [],
    ),
  );
  for (const [productId, qty] of qtyByProduct(left.filter((l) => l.qty > 0))) {
    if (live.has(productId)) await moveStock(db, productId, qty, now);
  }

  if (dueLeft > 0 && sale.customerId) {
    const customer = await db.customers.get(sale.customerId);
    if (customer && !customer.deletedAt) {
      await db.customers.update(customer.id, {
        balance: customer.balance - dueLeft,
        version: customer.version + 1,
        updatedAt: now,
      });
      await db.ledgerEntries.add({
        id: saleRecordIds.voidLedger(sale.id),
        storeId: ctx.storeId,
        partyType: "customer",
        partyId: customer.id,
        amountDelta: -dueLeft,
        refType: "sale_void",
        refId: sale.id,
        note: sale.invoiceNo,
        createdAt: now,
        updatedAt: now,
        createdBy: ctx.actorUserId,
        deviceId: ctx.deviceId,
        version: 1,
      });
    }
  }

  await db.sales.update(sale.id, {
    status: "voided",
    voidedAt: now,
    voidReason: input.reason,
    voidedBy: ctx.actorUserId,
    version: sale.version + 1,
    updatedAt: now,
  });

  return {
    ...input,
    customerId: sale.customerId,
    due: dueLeft,
    lines: left.filter((l) => l.qty > 0),
  };
}
