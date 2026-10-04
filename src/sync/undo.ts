import type { StoreDB } from "@/db/local/db";
import type { OutboxOp } from "@/db/local/types";

/**
 * When the server refuses an operation (or the person discards it), the device must go back to
 * what it showed before that operation: not only the record the operation created, but also what
 * it did to other records on the same device:
 *   - the stock movements and ledger entries it wrote,
 *   - the product stock and the customer or supplier balance those moved,
 *   - the lines of a sale or purchase, and a payment record,
 *   - a sale's "voided" mark.
 *
 * A command names the records it writes after its own id ("<id>:m0", "<id>:l", "<id>:i0"; a
 * cancellation uses "<id>:vm0" and "<id>:vl"), so they can be found again. Each number is moved back
 * by exactly what the removed records had moved it, which stays right whatever else is queued.
 *
 * Must run inside a transaction that includes every table.
 */
const HAS_EFFECTS = new Set([
  "sale.create",
  "sale.void",
  "saleReturn.create",
  "purchaseReturn.create",
  "purchase.create",
  "payment.collect",
  "payment.pay",
  "payment.void",
  "party.openingBalance",
]);

export async function undoLocalEffects(
  db: StoreDB,
  op: OutboxOp,
): Promise<void> {
  if (!HAS_EFFECTS.has(op.type)) return;
  const root = op.entityId;
  const isVoid = op.type === "sale.void" || op.type === "payment.void";
  const mine = (id: string) =>
    isVoid
      ? id.startsWith(`${root}:v`)
      : id.startsWith(`${root}:`) && !id.startsWith(`${root}:v`);

  // The records this operation wrote.
  const movements = (
    await db.stockMovements.where("id").startsWith(`${root}:`).toArray()
  ).filter((m) => mine(m.id));
  const ledger = (
    await db.ledgerEntries.where("id").startsWith(`${root}:`).toArray()
  ).filter((l) => mine(l.id));

  // What they moved, taken back.
  const stock = new Map<string, number>();
  for (const m of movements)
    stock.set(m.productId, (stock.get(m.productId) ?? 0) + m.qtyDelta);
  for (const [productId, delta] of stock) {
    const product = await db.products.get(productId);
    if (product)
      await db.products.update(productId, { stock: product.stock - delta });
  }
  const balance = new Map<string, { type: string; delta: number }>();
  for (const l of ledger) {
    const key = `${l.partyType}:${l.partyId}`;
    balance.set(key, {
      type: l.partyType,
      delta: (balance.get(key)?.delta ?? 0) + l.amountDelta,
    });
  }
  for (const [key, { type, delta }] of balance) {
    const partyId = key.slice(type.length + 1);
    const table = type === "customer" ? db.customers : db.suppliers;
    const party = await table.get(partyId);
    if (party)
      await table.update(partyId, { balance: (party.balance ?? 0) - delta });
  }
  await db.stockMovements.bulkDelete(movements.map((m) => m.id));
  await db.ledgerEntries.bulkDelete(ledger.map((l) => l.id));

  // The lines and records that belong to the operation's own document.
  if (op.type === "sale.create")
    await db.saleItems.where("saleId").equals(root).delete();
  if (op.type === "purchase.create")
    await db.purchaseItems.where("purchaseId").equals(root).delete();
  if (op.type === "payment.collect" || op.type === "payment.pay")
    await db.payments.delete(root);

  // A cancelled payment that was not cancelled after all: the payment is active again.
  if (op.type === "payment.void") {
    const payment = await db.payments.get(root);
    if (payment?.status === "voided")
      await db.payments.update(root, {
        status: "active",
        voidReason: undefined,
        voidedAt: undefined,
        voidedBy: undefined,
      });
  }

  // A cancellation that did not happen: the sale is as it was.
  if (op.type === "sale.void") {
    const sale = await db.sales.get(root);
    if (sale?.status === "voided")
      await db.sales.update(root, {
        status: "active",
        voidedAt: undefined,
        voidReason: undefined,
        voidedBy: undefined,
      });
  }
}
