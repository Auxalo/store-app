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
});
export type OpEnvelope = z.infer<typeof opEnvelopeSchema>;

export const MAX_OPS_PER_PUSH = 50;

export const pushRequestSchema = z.object({
  deviceId: z.uuid(),
  appVersion: z.string().max(32),
  ops: z.array(opEnvelopeSchema).min(1).max(MAX_OPS_PER_PUSH),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

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
}
