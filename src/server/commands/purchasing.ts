import type { CommandPayload } from "@/commands/definitions";
import { lineTotal } from "@/lib/qty";
import { qtyByProduct } from "@/lib/sale-math";
import { derivedSearchFields } from "@/lib/search-fields";
import { purchaseTotals } from "@/schemas/purchase";
import { returnTotal } from "@/schemas/return";
import type { WireChange } from "@/schemas/sync";
import { writeAudit } from "../audit";
import { allocSeq } from "../sync/txn";
import { type StoredDoc, toWire } from "./master-data";
import type { StoredMovement } from "./products";
import type { ApplyResult, ServerCtx } from "./types";

type Doc = Record<string, unknown> & { _id: string };

const wire = (
  collection: WireChange["collection"],
  doc: unknown,
): WireChange => ({
  collection,
  doc: toWire(doc as StoredDoc),
});
const later = (a: string, b: string) => (a > b ? a : b);
const stamp = (ctx: ServerCtx) => ({
  createdAt: ctx.opCreatedAt,
  updatedAt: ctx.opCreatedAt,
  createdBy: ctx.actorUserId,
  deviceId: ctx.deviceId,
  version: 1,
});

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

type PartyKind = "customer" | "supplier";
const PARTY_COLLECTION = {
  customer: "customers",
  supplier: "suppliers",
} as const;

async function liveParty(ctx: ServerCtx, kind: PartyKind, id: string | null) {
  if (!id) return null;
  return ctx.db
    .collection<StoredDoc & { name: string }>(PARTY_COLLECTION[kind])
    .findOne(
      { _id: id, storeId: ctx.storeId, deletedAt: null },
      { session: ctx.session },
    );
}

/** Moves a party's balance and writes its ledger entry. Uses two sequence numbers, starting at `seq`. */
async function adjustParty(
  ctx: ServerCtx,
  kind: PartyKind,
  party: StoredDoc,
  delta: number,
  ref: { type: string; id: string; ledgerId: string; note: string },
  seq: number,
): Promise<WireChange[]> {
  const updated = await ctx.db
    .collection<StoredDoc>(PARTY_COLLECTION[kind])
    .findOneAndUpdate(
      { _id: party._id, storeId: ctx.storeId },
      {
        $inc: { balance: delta, version: 1 },
        $set: {
          syncSeq: seq,
          "fieldVersions.balance": party.version + 1,
          updatedAt: later(ctx.opCreatedAt, party.updatedAt),
        },
      },
      { returnDocument: "after", session: ctx.session },
    );
  const entry = {
    _id: ref.ledgerId,
    storeId: ctx.storeId,
    partyType: kind,
    partyId: party._id,
    amountDelta: delta,
    refType: ref.type,
    refId: ref.id,
    note: ref.note,
    ...stamp(ctx),
    syncSeq: seq + 1,
  };
  await ctx.db
    .collection("ledgerEntries")
    .insertOne(entry as never, { session: ctx.session });
  return [
    wire(PARTY_COLLECTION[kind], updated ?? party),
    wire("ledgerEntries", entry),
  ];
}

function movementsFor(
  ctx: ServerCtx,
  docId: string,
  type: string,
  refType: string,
  note: string,
  rows: Array<{ index: number; productId: string; delta: number }>,
  firstSeq: number,
): StoredMovement[] {
  return rows.map((r, n) => ({
    _id: `${docId}:m${r.index}`,
    storeId: ctx.storeId,
    productId: r.productId,
    type,
    qtyDelta: r.delta,
    note,
    refType,
    refId: docId,
    ...stamp(ctx),
    syncSeq: firstSeq + n,
  }));
}

/** Applies stock changes (already summed per product) and returns the updated product documents. */
async function moveProducts(
  ctx: ServerCtx,
  products: Map<string, StoredDoc>,
  deltas: Map<string, number>,
  firstSeq: number,
  newCost?: Map<string, number>,
): Promise<WireChange[]> {
  const docs: WireChange[] = [];
  let seq = firstSeq;
  for (const [productId, delta] of deltas) {
    const product = products.get(productId) as StoredDoc;
    const cost = newCost?.get(productId);
    const costChanged = cost !== undefined && cost !== product.purchasePrice;
    const updated = await ctx.db
      .collection<StoredDoc>("products")
      .findOneAndUpdate(
        { _id: productId, storeId: ctx.storeId },
        {
          $inc: { stock: delta, version: 1 },
          $set: {
            syncSeq: seq++,
            "fieldVersions.stock": product.version + 1,
            ...(costChanged
              ? {
                  purchasePrice: cost,
                  "fieldVersions.purchasePrice": product.version + 1,
                }
              : {}),
            updatedAt: later(ctx.opCreatedAt, product.updatedAt),
          },
        },
        { returnDocument: "after", session: ctx.session },
      );
    if (costChanged) {
      await writeAudit(ctx, {
        action: "product.priceChange",
        entity: "product",
        entityId: productId,
        oldValue: { purchasePrice: product.purchasePrice },
        newValue: { purchasePrice: cost, via: "purchase" },
      });
    }
    docs.push(wire("products", updated ?? product));
  }
  return docs;
}

export async function purchaseCreate(
  ctx: ServerCtx,
  p: CommandPayload<"purchase.create">,
): Promise<ApplyResult> {
  const purchases = ctx.db.collection<Doc & { storeId: string }>("purchases");
  const existing = await purchases.findOne(
    { _id: p.id },
    { session: ctx.session },
  );
  if (existing) {
    return existing.storeId === ctx.storeId
      ? { status: "applied", docs: [wire("purchases", existing)] }
      : { status: "rejected", error: "ID_COLLISION" };
  }

  const totals = purchaseTotals(p.lines, p.discount, p.paid);
  const products = await liveProducts(ctx, [
    ...new Set(p.lines.map((l) => l.productId)),
  ]);
  const stockRows = p.lines
    .map((l, index) => ({ index, productId: l.productId, delta: l.qty }))
    .filter((r) => products.has(r.productId));
  const deltas = qtyByProduct(
    stockRows.map((r) => ({ productId: r.productId, qty: r.delta })),
  );
  const supplier =
    totals.due > 0 ? await liveParty(ctx, "supplier", p.supplierId) : null;

  let seq = await allocSeq(
    ctx.db,
    ctx.session,
    ctx.storeId,
    1 + stockRows.length + deltas.size + (supplier ? 2 : 0),
  );
  const docs: WireChange[] = [];

  const purchase = {
    _id: p.id,
    storeId: ctx.storeId,
    purchaseNo: p.purchaseNo,
    invoiceRef: p.invoiceRef,
    supplierId: p.supplierId,
    supplierName: p.supplierName,
    ...derivedSearchFields("purchases", {
      purchaseNo: p.purchaseNo,
      invoiceRef: p.invoiceRef,
      supplierName: p.supplierName,
    }),
    date: p.date,
    subtotal: totals.subtotal,
    discount: totals.discount,
    total: totals.total,
    paid: totals.paid,
    due: totals.due,
    paymentMethod: p.paymentMethod,
    notes: p.notes,
    itemCount: p.lines.length,
    items: p.lines.map((l, index) => ({
      id: `${p.id}:i${index}`,
      productId: l.productId,
      productName: l.productName,
      productNameBn: l.productNameBn,
      unit: l.unit,
      qty: l.qty,
      unitCost: l.unitCost,
      discount: l.discount,
      lineTotal: Math.max(0, lineTotal(l.unitCost, l.qty) - l.discount),
    })),
    ...stamp(ctx),
    deletedAt: null,
    syncSeq: seq++,
  };
  await purchases.insertOne(purchase, { session: ctx.session });
  docs.push(wire("purchases", purchase));

  if (stockRows.length > 0) {
    const movements = movementsFor(
      ctx,
      p.id,
      "purchase",
      "purchase",
      p.purchaseNo,
      stockRows,
      seq,
    );
    seq += movements.length;
    await ctx.db
      .collection<StoredMovement>("stockMovements")
      .insertMany(movements, { session: ctx.session });
    for (const m of movements) docs.push(wire("stockMovements", m));
  }
  if (deltas.size > 0) {
    const newCost = p.updateCosts
      ? new Map(p.lines.map((l) => [l.productId, l.unitCost]))
      : undefined;
    docs.push(...(await moveProducts(ctx, products, deltas, seq, newCost)));
    seq += deltas.size;
  }
  if (supplier) {
    docs.push(
      ...(await adjustParty(
        ctx,
        "supplier",
        supplier,
        totals.due,
        {
          type: "purchase",
          id: p.id,
          ledgerId: `${p.id}:l`,
          note: p.purchaseNo,
        },
        seq,
      )),
    );
  }
  return { status: "applied", docs };
}

/** Collecting a due from a customer, or paying a supplier. */
export async function paymentCreate(
  ctx: ServerCtx,
  kind: PartyKind,
  p: CommandPayload<"payment.collect">,
): Promise<ApplyResult> {
  const payments = ctx.db.collection<Doc & { storeId: string }>("payments");
  const existing = await payments.findOne(
    { _id: p.id },
    { session: ctx.session },
  );
  if (existing) {
    return existing.storeId === ctx.storeId
      ? { status: "applied", docs: [wire("payments", existing)] }
      : { status: "rejected", error: "ID_COLLISION" };
  }
  const party = await liveParty(ctx, kind, p.partyId);
  if (!party) return { status: "rejected", error: "NOT_FOUND" };

  const seq = await allocSeq(ctx.db, ctx.session, ctx.storeId, 3);
  const payment = {
    _id: p.id,
    storeId: ctx.storeId,
    partyType: kind,
    partyId: p.partyId,
    partyName: party.name,
    amount: p.amount,
    method: p.method,
    note: p.note,
    ...stamp(ctx),
    syncSeq: seq,
  };
  await payments.insertOne(payment, { session: ctx.session });
  const partyDocs = await adjustParty(
    ctx,
    kind,
    party,
    -p.amount,
    { type: "payment", id: p.id, ledgerId: `${p.id}:l`, note: p.note },
    seq + 1,
  );
  return { status: "applied", docs: [wire("payments", payment), ...partyDocs] };
}

/** A balance that existed before the shop started using the app: a ledger entry and a balance change. */
export async function openingBalanceCreate(
  ctx: ServerCtx,
  p: CommandPayload<"party.openingBalance">,
): Promise<ApplyResult> {
  const ledgerId = `${p.id}:l`;
  const party = await liveParty(ctx, p.partyType, p.partyId);
  const existing = await ctx.db
    .collection<Doc & { storeId: string }>("ledgerEntries")
    .findOne({ _id: ledgerId }, { session: ctx.session });
  if (existing) {
    // Already applied (a retry that lost its answer): answer with what is there, change nothing.
    if (existing.storeId !== ctx.storeId)
      return { status: "rejected", error: "ID_COLLISION" };
    return {
      status: "applied",
      docs: [
        ...(party ? [wire(PARTY_COLLECTION[p.partyType], party)] : []),
        wire("ledgerEntries", existing),
      ],
    };
  }
  if (!party) return { status: "rejected", error: "NOT_FOUND" };

  const seq = await allocSeq(ctx.db, ctx.session, ctx.storeId, 2);
  const docs = await adjustParty(
    ctx,
    p.partyType,
    party,
    p.amount,
    { type: "opening", id: p.id, ledgerId, note: p.note },
    seq,
  );
  return { status: "applied", docs };
}

export async function expenseCreate(
  ctx: ServerCtx,
  p: CommandPayload<"expense.create">,
): Promise<ApplyResult> {
  const expenses = ctx.db.collection<Doc & { storeId: string }>("expenses");
  const existing = await expenses.findOne(
    { _id: p.id },
    { session: ctx.session },
  );
  if (existing) {
    return existing.storeId === ctx.storeId
      ? { status: "applied", docs: [wire("expenses", existing)] }
      : { status: "rejected", error: "ID_COLLISION" };
  }
  const syncSeq = await allocSeq(ctx.db, ctx.session, ctx.storeId);
  const { id, ...fields } = p;
  const expense = {
    _id: id,
    storeId: ctx.storeId,
    ...fields,
    status: "active",
    ...stamp(ctx),
    syncSeq,
  };
  await expenses.insertOne(expense, { session: ctx.session });
  return { status: "applied", docs: [wire("expenses", expense)] };
}

export async function expenseVoid(
  ctx: ServerCtx,
  p: CommandPayload<"expense.void">,
): Promise<ApplyResult> {
  const expenses = ctx.db.collection<StoredDoc & { status: string }>(
    "expenses",
  );
  const expense = await expenses.findOne(
    { _id: p.id, storeId: ctx.storeId },
    { session: ctx.session },
  );
  if (!expense) return { status: "rejected", error: "NOT_FOUND" };
  if (expense.status === "voided")
    return { status: "applied", docs: [wire("expenses", expense)] };

  const syncSeq = await allocSeq(ctx.db, ctx.session, ctx.storeId);
  const updated = await expenses.findOneAndUpdate(
    { _id: p.id, storeId: ctx.storeId },
    {
      $inc: { version: 1 },
      $set: {
        status: "voided",
        voidReason: p.reason,
        syncSeq,
        updatedAt: later(ctx.opCreatedAt, expense.updatedAt),
      },
    },
    { returnDocument: "after", session: ctx.session },
  );
  await writeAudit(ctx, {
    action: "expense.void",
    entity: "expense",
    entityId: p.id,
    oldValue: { status: "active" },
    newValue: { status: "voided", reason: p.reason },
  });
  return { status: "applied", docs: [wire("expenses", updated ?? expense)] };
}

/** Rejects a return that would send back more than was sold/bought, counting earlier returns too. */
async function returnProblem(
  ctx: ServerCtx,
  kind: "sale" | "purchase",
  refId: string,
  original: Array<{ productId: string; qty: number }>,
  lines: Array<{ itemIndex: number; productId: string; qty: number }>,
): Promise<string | null> {
  const prior = await ctx.db
    .collection<{ lines: Array<{ itemIndex: number; qty: number }> }>("returns")
    .find({ storeId: ctx.storeId, kind, refId }, { session: ctx.session })
    .toArray();
  const returned = new Map<number, number>();
  for (const r of prior)
    for (const l of r.lines)
      returned.set(l.itemIndex, (returned.get(l.itemIndex) ?? 0) + l.qty);

  const asked = new Map<number, number>();
  for (const line of lines) {
    const item = original[line.itemIndex];
    if (!item || item.productId !== line.productId) return "INVALID_LINE";
    asked.set(line.itemIndex, (asked.get(line.itemIndex) ?? 0) + line.qty);
  }
  for (const [index, qty] of asked) {
    if (qty > original[index].qty - (returned.get(index) ?? 0))
      return "RETURN_TOO_MUCH";
  }
  return null;
}

export async function saleReturnCreate(
  ctx: ServerCtx,
  p: CommandPayload<"saleReturn.create">,
): Promise<ApplyResult> {
  const returns = ctx.db.collection<Doc & { storeId: string }>("returns");
  const existing = await returns.findOne(
    { _id: p.id },
    { session: ctx.session },
  );
  if (existing) {
    return existing.storeId === ctx.storeId
      ? { status: "applied", docs: [wire("returns", existing)] }
      : { status: "rejected", error: "ID_COLLISION" };
  }

  const sale = await ctx.db
    .collection<{
      _id: string;
      invoiceNo: string;
      status: string;
      customerId: string | null;
      customerName: string;
      items: Array<{ productId: string; qty: number }>;
    }>("sales")
    .findOne({ _id: p.saleId, storeId: ctx.storeId }, { session: ctx.session });
  if (!sale) return { status: "rejected", error: "NOT_FOUND" };
  if (sale.status === "voided")
    return { status: "rejected", error: "SALE_VOIDED" };
  if (p.settlement === "credit" && !sale.customerId)
    return { status: "rejected", error: "NO_CUSTOMER" };
  const problem = await returnProblem(
    ctx,
    "sale",
    sale._id,
    sale.items,
    p.lines,
  );
  if (problem) return { status: "rejected", error: problem };

  const total = returnTotal(p.lines);
  const products = p.restock
    ? await liveProducts(ctx, [...new Set(p.lines.map((l) => l.productId))])
    : new Map<string, StoredDoc>();
  const stockRows = p.lines
    .map((l, index) => ({ index, productId: l.productId, delta: l.qty }))
    .filter((r) => products.has(r.productId));
  const deltas = qtyByProduct(
    stockRows.map((r) => ({ productId: r.productId, qty: r.delta })),
  );
  const customer =
    p.settlement === "credit"
      ? await liveParty(ctx, "customer", sale.customerId)
      : null;

  let seq = await allocSeq(
    ctx.db,
    ctx.session,
    ctx.storeId,
    1 + stockRows.length + deltas.size + (customer ? 2 : 0),
  );
  const docs: WireChange[] = [];
  const doc = {
    _id: p.id,
    storeId: ctx.storeId,
    kind: "sale",
    returnNo: p.returnNo,
    refId: sale._id,
    refNo: sale.invoiceNo,
    partyId: sale.customerId,
    partyName: sale.customerName,
    lines: p.lines.map((l) => ({
      itemIndex: l.itemIndex,
      productId: l.productId,
      productName: l.productName,
      productNameBn: l.productNameBn,
      unit: l.unit,
      qty: l.qty,
      unitAmount: l.unitPrice,
    })),
    total,
    settlement: p.settlement,
    restock: p.restock,
    notes: p.notes,
    ...stamp(ctx),
    syncSeq: seq++,
  };
  await returns.insertOne(doc, { session: ctx.session });
  docs.push(wire("returns", doc));

  if (stockRows.length > 0) {
    const movements = movementsFor(
      ctx,
      p.id,
      "sale_return",
      "sale_return",
      p.returnNo,
      stockRows,
      seq,
    );
    seq += movements.length;
    await ctx.db
      .collection<StoredMovement>("stockMovements")
      .insertMany(movements, { session: ctx.session });
    for (const m of movements) docs.push(wire("stockMovements", m));
    docs.push(...(await moveProducts(ctx, products, deltas, seq)));
    seq += deltas.size;
  }
  if (customer) {
    docs.push(
      ...(await adjustParty(
        ctx,
        "customer",
        customer,
        -total,
        {
          type: "sale_return",
          id: p.id,
          ledgerId: `${p.id}:l`,
          note: p.returnNo,
        },
        seq,
      )),
    );
  }
  return { status: "applied", docs };
}

export async function purchaseReturnCreate(
  ctx: ServerCtx,
  p: CommandPayload<"purchaseReturn.create">,
): Promise<ApplyResult> {
  const returns = ctx.db.collection<Doc & { storeId: string }>("returns");
  const existing = await returns.findOne(
    { _id: p.id },
    { session: ctx.session },
  );
  if (existing) {
    return existing.storeId === ctx.storeId
      ? { status: "applied", docs: [wire("returns", existing)] }
      : { status: "rejected", error: "ID_COLLISION" };
  }

  const purchase = await ctx.db
    .collection<{
      _id: string;
      purchaseNo: string;
      supplierId: string | null;
      supplierName: string;
      items: Array<{ productId: string; qty: number }>;
    }>("purchases")
    .findOne(
      { _id: p.purchaseId, storeId: ctx.storeId },
      { session: ctx.session },
    );
  if (!purchase) return { status: "rejected", error: "NOT_FOUND" };
  if (p.settlement === "credit" && !purchase.supplierId)
    return { status: "rejected", error: "NO_SUPPLIER" };
  const problem = await returnProblem(
    ctx,
    "purchase",
    purchase._id,
    purchase.items,
    p.lines,
  );
  if (problem) return { status: "rejected", error: problem };

  const total = returnTotal(p.lines);
  const products = await liveProducts(ctx, [
    ...new Set(p.lines.map((l) => l.productId)),
  ]);
  const stockRows = p.lines
    .map((l, index) => ({ index, productId: l.productId, delta: -l.qty }))
    .filter((r) => products.has(r.productId));
  const deltas = new Map<string, number>();
  for (const r of stockRows)
    deltas.set(r.productId, (deltas.get(r.productId) ?? 0) + r.delta);
  const supplier =
    p.settlement === "credit"
      ? await liveParty(ctx, "supplier", purchase.supplierId)
      : null;

  let seq = await allocSeq(
    ctx.db,
    ctx.session,
    ctx.storeId,
    1 + stockRows.length + deltas.size + (supplier ? 2 : 0),
  );
  const docs: WireChange[] = [];
  const doc = {
    _id: p.id,
    storeId: ctx.storeId,
    kind: "purchase",
    returnNo: p.returnNo,
    refId: purchase._id,
    refNo: purchase.purchaseNo,
    partyId: purchase.supplierId,
    partyName: purchase.supplierName,
    lines: p.lines.map((l) => ({
      itemIndex: l.itemIndex,
      productId: l.productId,
      productName: l.productName,
      productNameBn: l.productNameBn,
      unit: l.unit,
      qty: l.qty,
      unitAmount: l.unitCost,
    })),
    total,
    settlement: p.settlement,
    restock: false,
    notes: p.notes,
    ...stamp(ctx),
    syncSeq: seq++,
  };
  await returns.insertOne(doc, { session: ctx.session });
  docs.push(wire("returns", doc));

  if (stockRows.length > 0) {
    const movements = movementsFor(
      ctx,
      p.id,
      "purchase_return",
      "purchase_return",
      p.returnNo,
      stockRows,
      seq,
    );
    seq += movements.length;
    await ctx.db
      .collection<StoredMovement>("stockMovements")
      .insertMany(movements, { session: ctx.session });
    for (const m of movements) docs.push(wire("stockMovements", m));
    docs.push(...(await moveProducts(ctx, products, deltas, seq)));
    seq += deltas.size;
  }
  if (supplier) {
    docs.push(
      ...(await adjustParty(
        ctx,
        "supplier",
        supplier,
        -total,
        {
          type: "purchase_return",
          id: p.id,
          ledgerId: `${p.id}:l`,
          note: p.returnNo,
        },
        seq,
      )),
    );
  }
  return { status: "applied", docs };
}
