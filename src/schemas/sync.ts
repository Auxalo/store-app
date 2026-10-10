import { z } from "zod";
import type { BillingStamp } from "@/billing/state";
import type { SyncCollection } from "@/commands/definitions";
import { idSchema, isoDateSchema } from "./common";

/** One queued business action, as sent to the server. */
export const opEnvelopeSchema = z.object({
  operationId: z.uuid(),
  type: z.string().min(1).max(64),
  schemaVersion: z.number().int().positive(),
  payload: z.unknown(),
  actorUserId: idSchema,
  deviceId: z.uuid(),
  createdAt: isoDateSchema,
  /** Signature of the action by the person it names (owner and manager actions need one). */
  proof: z.string().max(64).optional(),
});
export type OpEnvelope = z.infer<typeof opEnvelopeSchema>;

export const MAX_OPS_PER_PUSH = 50;

/**
 * What a device sends. Each operation is checked on its own when it is applied (see handlePush), so
 * one malformed operation is refused by itself and never stops the good ones behind it.
 */
export const pushRequestSchema = z.object({
  deviceId: z.uuid(),
  appVersion: z.string().max(32),
  ops: z.array(z.unknown()).min(1).max(MAX_OPS_PER_PUSH),
});
export interface PushRequest {
  deviceId: string;
  appVersion: string;
  ops: OpEnvelope[];
}

/** A synced record as it travels over the wire (Mongo `_id` becomes `id`). */
export interface WireDoc {
  id: string;
  version: number;
  syncSeq: number;
  updatedAt: string;
  deletedAt?: string | null;
  [field: string]: unknown;
}

export interface WireChange {
  collection: SyncCollection;
  doc: WireDoc;
}

export type PushResultStatus =
  /** Applied for the first time. */
  | "applied"
  /** Already applied earlier (a retry). Treated exactly like `applied`. */
  | "duplicate"
  /** Concurrent edit of the same important field. Needs a human decision. */
  | "conflict"
  /** Permanently invalid (validation, permission, entity gone). Will not succeed on retry. */
  | "rejected"
  /** Transient server problem. Try again later; order is preserved. */
  | "retry";

export interface PushResult {
  operationId: string;
  status: PushResultStatus;
  error?: string;
  /** Authoritative state of the touched records (for applied/duplicate), or the server's version (conflict/rejected). */
  docs?: WireChange[];
}

export interface PushResponse {
  serverTime: string;
  results: PushResult[];
}

export type PullChanges = Record<SyncCollection, WireDoc[]>;

export interface PullResponse {
  serverTime: string;
  /** Pass this back as `cursor` to get the next page. */
  cursor: number;
  hasMore: boolean;
  changes: PullChanges;
  /** The shop's billing (the endpoint adds it; older servers did not send it). */
  billing?: BillingStamp;
  /** Moves when the shop's people or PINs change: a device re-reads the staff list only then. */
  staffVersion?: number;
}
