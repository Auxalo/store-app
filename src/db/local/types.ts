import type { CommandType, SyncCollection } from "@/commands/definitions";
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
  entityId: string;
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
