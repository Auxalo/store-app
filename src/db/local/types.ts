import type { CommandType, SyncCollection } from "@/commands/definitions";
import type { UnitCode } from "@/lib/units";
import type { StockMovementType } from "@/schemas/product";
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
}
