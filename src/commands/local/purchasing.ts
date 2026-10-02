import type { StoreDB } from "@/db/local/db";
import { lineTotal } from "@/lib/qty";
import { qtyByProduct } from "@/lib/sale-math";
import { derivedSearchFields } from "@/lib/search-fields";
import { purchaseTotals } from "@/schemas/purchase";
import { returnTotal } from "@/schemas/return";
import type { CommandInput, CommandPayload } from "../definitions";
import { AlreadyExistsError, NotFoundError } from "../errors";
import type { LocalContext } from "./registry";
import { nextDocNo } from "./sales";

const supplierFields = (s: object) =>
  derivedSearchFields("suppliers", s as Record<string, unknown>);

export async function supplierCreate(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"supplier.create">,
  now: string,
) {
  if (await db.suppliers.get(input.id))
    throw new AlreadyExistsError("supplier");
  await db.suppliers.add({
    ...input,
    balance: 0,
    storeId: ctx.storeId,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
    deletedAt: null,
    ...supplierFields(input),
  });
  return input;
}

export async function supplierUpdate(
  db: StoreDB,
  input: CommandInput<"supplier.update">,
  now: string,
) {
  const doc = await db.suppliers.get(input.id);
  if (!doc || doc.deletedAt) throw new NotFoundError("supplier");
  await db.suppliers.update(input.id, {
    ...input.changes,
    ...supplierFields({ ...doc, ...input.changes }),
    version: doc.version + 1,
    updatedAt: now,
  });
  return { ...input, baseVersion: doc.version };
}

export async function supplierDelete(
  db: StoreDB,
  input: CommandInput<"supplier.delete">,
  now: string,
) {
  const doc = await db.suppliers.get(input.id);
  if (!doc || doc.deletedAt) throw new NotFoundError("supplier");
  await db.suppliers.update(input.id, {
    deletedAt: now,
    version: doc.version + 1,
    updatedAt: now,
  });
  return { ...input, baseVersion: doc.version };
}

type PartyKind = "customer" | "supplier";

/**
 * Moves a customer's (money they owe us) or supplier's (money we owe them) balance and writes the
 * matching ledger entry. Positive `delta` increases what is owed. Returns the party, or null if it
 * no longer exists on this device (then nothing is written).
 */
export async function adjustParty(
  db: StoreDB,
  ctx: LocalContext,
  kind: PartyKind,
  partyId: string,
  delta: number,
  ref: { type: string; id: string; ledgerId: string; note: string },
  now: string,
) {
  const table = kind === "customer" ? db.customers : db.suppliers;
  const party = await table.get(partyId);
  if (!party || party.deletedAt) return null;
  await table.update(partyId, {
    balance: party.balance + delta,
    version: party.version + 1,
    updatedAt: now,
  } as never);
  await db.ledgerEntries.add({
    id: ref.ledgerId,
    storeId: ctx.storeId,
    partyType: kind,
    partyId,
    amountDelta: delta,
    refType: ref.type,
    refId: ref.id,
    note: ref.note,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
  });
  return party;
}

/** Stock moves on this device for the products that still exist; returns which ones those are. */
async function liveProductIds(db: StoreDB, productIds: Iterable<string>) {
  const live = new Set<string>();
  for (const id of new Set(productIds)) {
    const product = await db.products.get(id);
    if (product && !product.deletedAt) live.add(id);
  }
  return live;
}

export async function purchaseCreate(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"purchase.create">,
  now: string,
): Promise<CommandPayload<"purchase.create">> {
  if (await db.purchases.get(input.id))
    throw new AlreadyExistsError("purchase");
  const purchaseNo = await nextDocNo(db, ctx.deviceId, now, "P");
  const totals = purchaseTotals(input.lines, input.discount, input.paid);
  const live = await liveProductIds(
    db,
    input.lines.map((l) => l.productId),
  );

  await db.purchaseItems.bulkAdd(
    input.lines.map((line, index) => ({
      id: `${input.id}:i${index}`,
      purchaseId: input.id,
      productId: line.productId,
      productName: line.productName,
      productNameBn: line.productNameBn,
      unit: line.unit,
      qty: line.qty,
      unitCost: line.unitCost,
      discount: line.discount,
      lineTotal: Math.max(
        0,
        lineTotal(line.unitCost, line.qty) - line.discount,
      ),
      createdAt: now,
    })),
  );
  await db.stockMovements.bulkAdd(
    input.lines.flatMap((line, index) =>
      live.has(line.productId)
        ? [
            {
              id: `${input.id}:m${index}`,
              storeId: ctx.storeId,
              productId: line.productId,
              type: "purchase" as const,
              qtyDelta: line.qty,
              note: purchaseNo,
              refType: "purchase",
              refId: input.id,
              createdAt: now,
              createdBy: ctx.actorUserId,
              deviceId: ctx.deviceId,
            },
          ]
        : [],
    ),
  );
  const lastCost = new Map(input.lines.map((l) => [l.productId, l.unitCost]));
  for (const [productId, qty] of qtyByProduct(input.lines)) {
    if (!live.has(productId)) continue;
    const product = await db.products.get(productId);
    if (!product) continue;
    await db.products.update(productId, {
      stock: product.stock + qty,
      ...(input.updateCosts
        ? { purchasePrice: lastCost.get(productId) ?? product.purchasePrice }
        : {}),
      version: product.version + 1,
      updatedAt: now,
    });
  }
  if (totals.due > 0 && input.supplierId) {
    await adjustParty(
      db,
      ctx,
      "supplier",
      input.supplierId,
      totals.due,
      {
        type: "purchase",
        id: input.id,
        ledgerId: `${input.id}:l`,
        note: purchaseNo,
      },
      now,
    );
  }

  await db.purchases.add({
    id: input.id,
    storeId: ctx.storeId,
    purchaseNo,
    invoiceRef: input.invoiceRef,
    supplierId: input.supplierId,
    supplierName: input.supplierName,
    date: input.date,
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    paid: totals.paid,
    due: totals.due,
    paymentMethod: input.paymentMethod,
    notes: input.notes,
    itemCount: input.lines.length,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
    deletedAt: null,
  });
  return { ...input, purchaseNo };
}

/** Collecting a due from a customer, or paying a supplier: a payment record plus a ledger entry. */
export async function paymentCreate(
  db: StoreDB,
  ctx: LocalContext,
  kind: PartyKind,
  input: CommandInput<"payment.collect">,
  now: string,
) {
  if (await db.payments.get(input.id)) throw new AlreadyExistsError("payment");
  const party = await adjustParty(
    db,
    ctx,
    kind,
    input.partyId,
    -input.amount,
    {
      type: "payment",
      id: input.id,
      ledgerId: `${input.id}:l`,
      note: input.note,
    },
    now,
  );
  if (!party) throw new NotFoundError(kind);
  await db.payments.add({
    id: input.id,
    storeId: ctx.storeId,
    partyType: kind,
    partyId: input.partyId,
    partyName: party.name,
    amount: input.amount,
    method: input.method,
    note: input.note,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
  });
  return input;
}

/** Records the balance a customer or supplier already had when the shop started using the app. */
export async function openingBalanceCreate(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"party.openingBalance">,
  now: string,
) {
  const ledgerId = `${input.id}:l`;
  if (await db.ledgerEntries.get(ledgerId))
    throw new AlreadyExistsError("opening balance");
  const party = await adjustParty(
    db,
    ctx,
    input.partyType,
    input.partyId,
    input.amount,
    { type: "opening", id: input.id, ledgerId, note: input.note },
    now,
  );
  if (!party) throw new NotFoundError(input.partyType);
  return input;
}

export async function expenseCreate(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"expense.create">,
  now: string,
) {
  if (await db.expenses.get(input.id)) throw new AlreadyExistsError("expense");
  await db.expenses.add({
    ...input,
    storeId: ctx.storeId,
    status: "active",
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
  });
  return input;
}

export async function expenseVoid(
  db: StoreDB,
  input: CommandInput<"expense.void">,
  now: string,
) {
  const expense = await db.expenses.get(input.id);
  if (!expense) throw new NotFoundError("expense");
  if (expense.status === "voided") throw new AlreadyExistsError("void");
  await db.expenses.update(input.id, {
    status: "voided",
    voidReason: input.reason,
    version: expense.version + 1,
    updatedAt: now,
  });
  return input;
}

/** How much of each line of a sale/purchase has already come back, by line position. */
async function alreadyReturned(
  db: StoreDB,
  kind: "sale" | "purchase",
  refId: string,
) {
  const returned = new Map<number, number>();
  for (const r of await db.returns.where("refId").equals(refId).toArray()) {
    if (r.kind !== kind) continue;
    for (const l of r.lines)
      returned.set(l.itemIndex, (returned.get(l.itemIndex) ?? 0) + l.qty);
  }
  return returned;
}

async function checkReturnLines(
  db: StoreDB,
  kind: "sale" | "purchase",
  refId: string,
  original: Array<{ productId: string; qty: number }>,
  lines: Array<{ itemIndex: number; productId: string; qty: number }>,
) {
  const returned = await alreadyReturned(db, kind, refId);
  const asked = new Map<number, number>();
  for (const line of lines) {
    const item = original[line.itemIndex];
    if (!item || item.productId !== line.productId)
      throw new NotFoundError("line");
    asked.set(line.itemIndex, (asked.get(line.itemIndex) ?? 0) + line.qty);
  }
  for (const [index, qty] of asked) {
    const item = original[index];
    if (qty > item.qty - (returned.get(index) ?? 0))
      throw new Error("RETURN_TOO_MUCH");
  }
}

export async function saleReturnCreate(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"saleReturn.create">,
  now: string,
): Promise<CommandPayload<"saleReturn.create">> {
  if (await db.returns.get(input.id)) throw new AlreadyExistsError("return");
  const sale = await db.sales.get(input.saleId);
  if (!sale || sale.status === "voided") throw new NotFoundError("sale");
  if (input.settlement === "credit" && !sale.customerId)
    throw new Error("NO_CUSTOMER");

  const items = (
    await db.saleItems.where("saleId").equals(sale.id).toArray()
  ).sort((a, b) => Number(a.id.split(":i")[1]) - Number(b.id.split(":i")[1]));
  await checkReturnLines(db, "sale", sale.id, items, input.lines);

  const returnNo = await nextDocNo(db, ctx.deviceId, now, "R");
  const total = returnTotal(input.lines);

  if (input.restock) {
    const live = await liveProductIds(
      db,
      input.lines.map((l) => l.productId),
    );
    await db.stockMovements.bulkAdd(
      input.lines.flatMap((line, index) =>
        live.has(line.productId)
          ? [
              {
                id: `${input.id}:m${index}`,
                storeId: ctx.storeId,
                productId: line.productId,
                type: "sale_return" as const,
                qtyDelta: line.qty,
                note: returnNo,
                refType: "sale_return",
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
      if (!live.has(productId)) continue;
      const product = await db.products.get(productId);
      if (product)
        await db.products.update(productId, {
          stock: product.stock + qty,
          version: product.version + 1,
          updatedAt: now,
        });
    }
  }
  if (input.settlement === "credit" && sale.customerId) {
    await adjustParty(
      db,
      ctx,
      "customer",
      sale.customerId,
      -total,
      {
        type: "sale_return",
        id: input.id,
        ledgerId: `${input.id}:l`,
        note: returnNo,
      },
      now,
    );
  }

  await db.returns.add({
    id: input.id,
    storeId: ctx.storeId,
    kind: "sale",
    returnNo,
    refId: sale.id,
    refNo: sale.invoiceNo,
    partyId: sale.customerId,
    partyName: sale.customerName,
    lines: input.lines.map((l) => ({
      itemIndex: l.itemIndex,
      productId: l.productId,
      productName: l.productName,
      productNameBn: l.productNameBn,
      unit: l.unit,
      qty: l.qty,
      unitAmount: l.unitPrice,
    })),
    total,
    settlement: input.settlement,
    restock: input.restock,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
  });
  return { ...input, returnNo, customerId: sale.customerId };
}

export async function purchaseReturnCreate(
  db: StoreDB,
  ctx: LocalContext,
  input: CommandInput<"purchaseReturn.create">,
  now: string,
): Promise<CommandPayload<"purchaseReturn.create">> {
  if (await db.returns.get(input.id)) throw new AlreadyExistsError("return");
  const purchase = await db.purchases.get(input.purchaseId);
  if (!purchase) throw new NotFoundError("purchase");
  if (input.settlement === "credit" && !purchase.supplierId)
    throw new Error("NO_SUPPLIER");

  const items = (
    await db.purchaseItems.where("purchaseId").equals(purchase.id).toArray()
  ).sort((a, b) => Number(a.id.split(":i")[1]) - Number(b.id.split(":i")[1]));
  await checkReturnLines(db, "purchase", purchase.id, items, input.lines);

  const returnNo = await nextDocNo(db, ctx.deviceId, now, "PR");
  const total = returnTotal(input.lines);
  const live = await liveProductIds(
    db,
    input.lines.map((l) => l.productId),
  );

  await db.stockMovements.bulkAdd(
    input.lines.flatMap((line, index) =>
      live.has(line.productId)
        ? [
            {
              id: `${input.id}:m${index}`,
              storeId: ctx.storeId,
              productId: line.productId,
              type: "purchase_return" as const,
              qtyDelta: -line.qty,
              note: returnNo,
              refType: "purchase_return",
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
    if (!live.has(productId)) continue;
    const product = await db.products.get(productId);
    if (product)
      await db.products.update(productId, {
        stock: product.stock - qty,
        version: product.version + 1,
        updatedAt: now,
      });
  }
  if (input.settlement === "credit" && purchase.supplierId) {
    await adjustParty(
      db,
      ctx,
      "supplier",
      purchase.supplierId,
      -total,
      {
        type: "purchase_return",
        id: input.id,
        ledgerId: `${input.id}:l`,
        note: returnNo,
      },
      now,
    );
  }

  await db.returns.add({
    id: input.id,
    storeId: ctx.storeId,
    kind: "purchase",
    returnNo,
    refId: purchase.id,
    refNo: purchase.purchaseNo,
    partyId: purchase.supplierId,
    partyName: purchase.supplierName,
    lines: input.lines.map((l) => ({
      itemIndex: l.itemIndex,
      productId: l.productId,
      productName: l.productName,
      productNameBn: l.productNameBn,
      unit: l.unit,
      qty: l.qty,
      unitAmount: l.unitCost,
    })),
    total,
    settlement: input.settlement,
    restock: false,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    version: 1,
  });
  return { ...input, returnNo, supplierId: purchase.supplierId };
}
