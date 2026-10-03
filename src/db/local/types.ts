import type { BillingStamp } from "@/billing/state";
import type { CommandType, SyncCollection } from "@/commands/definitions";
import type { UnitCode } from "@/lib/units";
import type { ExpenseCategory } from "@/schemas/expense";
import type { StockMovementType } from "@/schemas/product";
import type { PaymentMethod } from "@/schemas/sale";
import type { WireDoc } from "@/schemas/sync";

/** Fields every synced business record carries (spec §33). */
export interface SyncedBase {
  id: string;
  storeId: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  /** Version as this device currently expects the server to be (includes unsynced local edits). */
  version: number;
  deletedAt?: string | null;
  /** Server sequence of the last server state seen for this record; absent until first synced. */
  syncSeq?: number;
}

export interface Category extends SyncedBase {
  name: string;
  nameBn: string;
  description: string;
  isActive: boolean;
}

export interface Product extends SyncedBase {
  name: string;
  nameBn: string;
  sku: string;
  barcode: string;
  categoryId: string | null;
  unit: UnitCode;
  /** Poisha per 1 unit. */
  purchasePrice: number;
  sellingPrice: number;
  /** Milli-units. Server stock plus movements this device has not synced yet. */
  stock: number;
  lowStockThreshold: number;
  description: string;
  isActive: boolean;
  /** Normalized words for the search index. Computed on this device, never synced. */
  searchWords: string[];
  /** Normalised name, so lists sort A-Z the same way on the device and the server. */
  nameKey?: string;
}

/** One line of the stock ledger. Append-only: stock is the sum of movements, never overwritten. */
export interface StockMovement {
  id: string;
  storeId: string;
  productId: string;
  type: StockMovementType;
  /** Signed change in milli-units. */
  qtyDelta: number;
  note: string;
  refType?: string | null;
  refId?: string | null;
  createdAt: string;
  createdBy: string;
  deviceId: string;
  syncSeq?: number;
}

export interface Customer extends SyncedBase {
  name: string;
  phone: string;
  address: string;
  notes: string;
  /** Poisha this customer owes us (negative: we owe them). Server balance plus unsynced local sales. */
  balance: number;
  /** Normalized words for the search index. Computed on this device, never synced. */
  searchWords: string[];
  /** Normalised name for A-Z sorting. */
  nameKey?: string;
}

export interface Sale {
  id: string;
  storeId: string;
  invoiceNo: string;
  customerId: string | null;
  customerName: string;
  /** The buyer's phone at the time of sale, so the sale can be found by it. */
  customerPhone?: string;
  /** Normalised search words (invoice number, buyer). Computed locally, never synced. */
  searchWords?: string[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  due: number;
  paymentMethod: PaymentMethod;
  notes: string;
  status: "active" | "voided";
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  version: number;
  voidedAt?: string | null;
  voidReason?: string;
  voidedBy?: string | null;
  deletedAt?: string | null;
  syncSeq?: number;
}

/** A sale line, copied at sale time so the receipt never changes when a product is edited. */
export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  productNameBn: string;
  unit: UnitCode;
  qty: number;
  listPrice: number;
  unitPrice: number;
  unitCost: number;
  discount: number;
  lineTotal: number;
  createdAt: string;
}

/** Money owed between the store and a customer or supplier. Balance = sum of entries. Append-only. */
export interface LedgerEntry {
  id: string;
  storeId: string;
  partyType: "customer" | "supplier";
  partyId: string;
  /** Poisha. Positive: they owe us more. Negative: they paid / we owe them. */
  amountDelta: number;
  refType: string;
  refId: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  version: number;
  syncSeq?: number;
}

export interface Supplier extends SyncedBase {
  name: string;
  phone: string;
  email: string;
  address: string;
  contactPerson: string;
  notes: string;
  /** Poisha we owe this supplier (negative: they owe us). */
  balance: number;
  searchWords: string[];
  /** Normalised name for A-Z sorting. */
  nameKey?: string;
}

export interface Purchase {
  id: string;
  storeId: string;
  /** Our own number for the purchase, e.g. P-A-2610-0001. */
  purchaseNo: string;
  /** The supplier's invoice number, if any. */
  invoiceRef: string;
  supplierId: string | null;
  supplierName: string;
  /** Normalised search words. Computed locally, never synced. */
  searchWords?: string[];
  /** Day the goods arrived, yyyy-mm-dd. */
  date: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  due: number;
  paymentMethod: PaymentMethod;
  notes: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  version: number;
  deletedAt?: string | null;
  syncSeq?: number;
}

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  productId: string;
  productName: string;
  productNameBn: string;
  unit: UnitCode;
  qty: number;
  unitCost: number;
  discount: number;
  lineTotal: number;
  createdAt: string;
}

/** Money received from a customer or paid to a supplier. */
export interface Payment {
  id: string;
  storeId: string;
  partyType: "customer" | "supplier";
  partyId: string;
  partyName: string;
  amount: number;
  method: PaymentMethod;
  note: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  version: number;
  syncSeq?: number;
}

export interface Expense {
  id: string;
  storeId: string;
  category: ExpenseCategory;
  amount: number;
  description: string;
  date: string;
  method: PaymentMethod;
  notes: string;
  status: "active" | "voided";
  voidReason?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  version: number;
  syncSeq?: number;
}

export interface ReturnLine {
  itemIndex: number;
  productId: string;
  productName: string;
  productNameBn: string;
  unit: UnitCode;
  qty: number;
  /** Refund per unit (the sale price, or for purchases the cost). */
  unitAmount: number;
}

/** A return keeps the original invoice untouched; it is its own record. */
export interface ReturnDoc {
  id: string;
  storeId: string;
  kind: "sale" | "purchase";
  returnNo: string;
  /** The sale or purchase being returned against. */
  refId: string;
  refNo: string;
  partyId: string | null;
  partyName: string;
  lines: ReturnLine[];
  total: number;
  settlement: "cash" | "credit";
  restock: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  version: number;
  syncSeq?: number;
}

/**
 * A person who can work on this device. Copied from the server so the "who is working?" screen and
 * PIN check work offline. The wrong-PIN counters are local to this device.
 */
export interface LocalUser {
  userId: string;
  name: string;
  username: string;
  role: "owner" | "manager" | "cashier";
  isActive: boolean;
  pinSalt?: string;
  pinHash?: string;
  failedPins: number;
  lastFailedAt: number;
}

/** Work in progress that must survive a reload (the cart). Never synced. */
export interface Draft {
  key: string;
  value: unknown;
}

export interface Setting extends Omit<SyncedBase, "createdBy"> {
  /** Same as `id`: settings are keyed by their name. */
  key: string;
  value: unknown;
  updatedBy?: string;
}

export type OutboxStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "conflict";

/** One queued business action waiting to reach the server (spec §24 `syncQueue`). */
export interface OutboxOp {
  /** Auto-increment: strict creation order, even for operations created in the same millisecond. */
  seq?: number;
  operationId: string;
  type: CommandType;
  collection: SyncCollection;
  /** Primary record the operation is about. */
  entityId: string;
  /** Every record it changes (indexed, so unsynced operations can be replayed per record). */
  entityIds: string[];
  schemaVersion: number;
  payload: unknown;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms before which this operation will not be retried (backoff). */
  nextAttemptAt: number;
  lastError?: string;
  /** The server's version of the record, for conflicts and rejections. */
  serverDoc?: WireDoc;
  syncedAt?: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface MetaValues {
  deviceId: string;
  deviceCode: string;
  storeId: string;
  /** Last server sequence this device has fully applied. */
  cursor: number;
  lastSyncAt: number;
  lastAttemptAt: number;
  /** serverTime − deviceTime in ms; large values mean the device clock is wrong. */
  clockOffsetMs: number;
  /** Per device, per month: the last invoice sequence number used ("2610" → 42). */
  invoiceSeq: Record<string, number>;
  /** When old, already-sent operations were last cleared out. */
  lastPruneAt: number;
  /** The last automatic SKU number this device issued (A0042 → 42). */
  skuSeq: number;
  /** How this device gets its data: "online" (ask the server) or "offline" (a full copy on the device). */
  dataMode: "online" | "offline";
  /** The shop's billing as the server last said (see src/billing/client.ts). */
  billing: BillingStamp;
  /** The latest server time this device has seen (turning its clock back does not undo a lock). */
  billingClockHwm: number;
}
