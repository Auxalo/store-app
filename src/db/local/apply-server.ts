import type { SyncCollection } from "@/commands/definitions";
import { computeTotals, qtyByProduct } from "@/lib/sale-math";
import { searchWords } from "@/lib/search";
import { purchaseTotals } from "@/schemas/purchase";
import { returnTotal } from "@/schemas/return";
import type { WireDoc } from "@/schemas/sync";
import type { StoreDB } from "./db";
import type { OutboxOp, OutboxStatus } from "./types";

/** Operations whose effect the device still shows but the server has not confirmed. */
const UNCONFIRMED: readonly OutboxStatus[] = ["pending", "syncing", "conflict"];

type Doc = WireDoc & Record<string, unknown>;

/** Re-applies one unconfirmed local operation on top of a server record. */
function overlay(doc: Doc, op: OutboxOp): Doc {
  const payload = op.payload as Record<string, unknown>;
  const bump = { version: doc.version + 1, updatedAt: op.createdAt };
  switch (op.type) {
    case "category.update":
    case "product.update":
      return { ...doc, ...(payload.changes as object), ...bump };
    case "category.delete":
    case "product.delete":
      return { ...doc, deletedAt: op.createdAt, ...bump };
    case "setting.set":
      return { ...doc, value: payload.value, ...bump };
    case "stock.adjust":
      // Stock is the server's sum plus the movements this device has not synced yet.
      return {
        ...doc,
        stock: (doc.stock as number) + (payload.qtyDelta as number),
        ...bump,
      };
    case "customer.update":
      return { ...doc, ...(payload.changes as object), ...bump };
    case "customer.delete":
      return { ...doc, deletedAt: op.createdAt, ...bump };
    case "supplier.update":
      return { ...doc, ...(payload.changes as object), ...bump };
    case "supplier.delete":
      return { ...doc, deletedAt: op.createdAt, ...bump };
    case "expense.void":
      return { ...doc, status: "voided", voidReason: payload.reason, ...bump };
    case "payment.collect":
    case "payment.pay":
      // Only the party's balance changes; the payment record itself is created by the operation.
      return payload.partyId === doc.id
        ? {
            ...doc,
            balance: (doc.balance as number) - (payload.amount as number),
            ...bump,
          }
        : doc;
    case "purchase.create":
      return overlayPurchase(doc, op);
    case "saleReturn.create":
      return overlayReturn(doc, op, "sale");
    case "purchaseReturn.create":
      return overlayReturn(doc, op, "purchase");
    case "sale.create":
      return overlaySale(doc, op, 1);
    case "sale.void":
      return overlaySale(doc, op, -1);
    default:
      return doc; // creates: the server already has the record
  }
}

/**
 * A sale (sign +1) or its cancellation (sign −1) touches several records. Replay the part that
 * concerns this one: the product's stock, the customer's balance, or the sale's own status.
 */
function overlaySale(doc: Doc, op: OutboxOp, sign: 1 | -1): Doc {
  const p = op.payload as {
    id?: string;
    saleId?: string;
    customerId: string | null;
    due?: number;
    lines: Array<{ productId: string; qty: number }>;
    discount?: number;
    tendered?: number;
  };
  const bump = { version: doc.version + 1, updatedAt: op.createdAt };
  const qty = qtyByProduct(p.lines).get(doc.id);
  if (qty !== undefined)
    return { ...doc, stock: (doc.stock as number) - sign * qty, ...bump };

  if (p.customerId === doc.id) {
    const due =
      sign === 1
        ? computeTotals(p.lines as never, p.discount ?? 0, p.tendered ?? 0).due
        : (p.due ?? 0);
    return due > 0
      ? { ...doc, balance: (doc.balance as number) + sign * due, ...bump }
      : doc;
  }
  if (sign === -1 && p.saleId === doc.id)
    return { ...doc, status: "voided", voidedAt: op.createdAt, ...bump };
  return doc;
}

/** A purchase brings stock in (and may reprice the product), and may add to what we owe the supplier. */
function overlayPurchase(doc: Doc, op: OutboxOp): Doc {
  const p = op.payload as {
    supplierId: string | null;
    lines: Array<{
      productId: string;
      qty: number;
      unitCost: number;
      discount: number;
    }>;
    discount: number;
    paid: number;
    updateCosts: boolean;
  };
  const bump = { version: doc.version + 1, updatedAt: op.createdAt };
  const qty = qtyByProduct(p.lines).get(doc.id);
  if (qty !== undefined) {
    const last = [...p.lines].reverse().find((l) => l.productId === doc.id);
    return {
      ...doc,
      stock: (doc.stock as number) + qty,
      ...(p.updateCosts && last ? { purchasePrice: last.unitCost } : {}),
      ...bump,
    };
  }
  if (p.supplierId === doc.id) {
    const { due } = purchaseTotals(p.lines, p.discount, p.paid);
    return due > 0
      ? { ...doc, balance: (doc.balance as number) + due, ...bump }
      : doc;
  }
  return doc;
}

/** A return puts goods back (sales) or sends them back (purchases), and may settle against the balance. */
function overlayReturn(doc: Doc, op: OutboxOp, kind: "sale" | "purchase"): Doc {
  const p = op.payload as {
    customerId?: string | null;
    supplierId?: string | null;
    lines: Array<{
      productId: string;
      qty: number;
      unitPrice?: number;
      unitCost?: number;
    }>;
    settlement: "cash" | "credit";
    restock?: boolean;
  };
  const bump = { version: doc.version + 1, updatedAt: op.createdAt };
  const qty = qtyByProduct(p.lines).get(doc.id);
  if (qty !== undefined) {
    if (kind === "sale")
      return p.restock
        ? { ...doc, stock: (doc.stock as number) + qty, ...bump }
        : doc;
    return { ...doc, stock: (doc.stock as number) - qty, ...bump };
  }
  const partyId = kind === "sale" ? p.customerId : p.supplierId;
  if (partyId === doc.id && p.settlement === "credit") {
    return {
      ...doc,
      balance: (doc.balance as number) - returnTotal(p.lines),
      ...bump,
    };
  }
  return doc;
}

/** Fields that exist only on this device (never synced), derived from the synced ones. */
export function withLocalFields(collection: SyncCollection, doc: Doc): Doc {
  if (collection === "products") {
    return {
      ...doc,
      searchWords: searchWords(
        doc.name as string,
        doc.nameBn as string,
        doc.sku as string,
        doc.barcode as string,
      ),
    };
  }
  if (collection === "suppliers") {
    return {
      ...doc,
      searchWords: searchWords(
        doc.name as string,
        doc.phone as string,
        doc.contactPerson as string,
      ),
    };
  }
  if (collection === "customers") {
    return {
      ...doc,
      searchWords: searchWords(doc.name as string, doc.phone as string),
    };
  }
  return doc;
}

/**
 * Writes server records into the device database WITHOUT losing local edits that have not synced.
 *
 * For each record: take the server's state, then replay every unconfirmed local operation on top.
 * So a pull that arrives while the cashier has unsynced edits never makes their change vanish,
 * and the version counter stays "server version + edits still in the queue".
 *
 * Must run inside a transaction that includes the target table and `outbox`.
 */
export async function applyServerDocs(
  db: StoreDB,
  collection: SyncCollection,
  docs: WireDoc[],
): Promise<void> {
  if (docs.length === 0) return;
  const table = db.table(collection);

  for (const incoming of docs) {
    const local = await table.get(incoming.id);
    // Older than what we already have (e.g. a duplicate delivery): ignore.
    if (local?.syncSeq !== undefined && incoming.syncSeq < local.syncSeq)
      continue;

    const unconfirmed = await db.outbox
      .where("entityIds")
      .equals(incoming.id)
      .filter((op) => UNCONFIRMED.includes(op.status))
      .sortBy("seq");

    const merged = unconfirmed.reduce<Doc>(
      (doc, op) => overlay(doc, op),
      incoming as Doc,
    );
    const record = withLocalFields(collection, merged);
    if (collection === "sales") {
      // The server keeps a sale's lines inside the sale; on the device they are their own table.
      const { items, ...sale } = record as Doc & {
        items?: Array<Record<string, unknown>>;
      };
      await table.put(sale);
      if (items?.length) {
        await db.saleItems.bulkPut(
          items.map((item) => ({
            ...item,
            saleId: sale.id,
            createdAt: sale.createdAt,
          })) as never,
        );
      }
    } else if (collection === "purchases") {
      const { items, ...purchase } = record as Doc & {
        items?: Array<Record<string, unknown>>;
      };
      await table.put(purchase);
      if (items?.length) {
        await db.purchaseItems.bulkPut(
          items.map((item) => ({
            ...item,
            purchaseId: purchase.id,
            createdAt: purchase.createdAt,
          })) as never,
        );
      }
    } else {
      await table.put(record);
    }
  }
}
