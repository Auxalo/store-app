import type { Document } from "mongodb";
import type { SyncCollection } from "@/commands/definitions";
import type { WireChange, WireDoc } from "@/schemas/sync";
import { allocSeq } from "../sync/txn";
import type { ApplyResult, ServerCtx } from "./types";

/**
 * Generic server logic for editable "master data" (categories, products, customers, ...).
 *
 * Every field remembers the version at which it last changed (`fieldVersions`). An edit carries the
 * version it was based on (`baseVersion`); if the record moved on, only fields that changed in the
 * meantime can clash:
 *   - no clash                    → merged automatically
 *   - clash on a normal field     → last write wins by the device's action time
 *   - clash on a critical field   → reported as a conflict for a person to decide (e.g. prices)
 */
export interface MasterConfig {
  collection: SyncCollection;
  criticalFields: readonly string[];
  /** Fields kept with the record that are worked out from its others (search words, sort key). */
  derive?: (doc: Record<string, unknown>) => Record<string, unknown>;
}

export interface StoredDoc extends Document {
  _id: string;
  storeId: string;
  version: number;
  fieldVersions: Record<string, number>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deviceId: string;
  deletedAt?: string | null;
  syncSeq: number;
}

/**
 * What goes to devices. Search words and the sort key are for searching on the server; devices
 * work them out themselves, so they are not sent.
 */
export function toWire(doc: StoredDoc): WireDoc {
  const {
    _id,
    fieldVersions: _internal,
    searchWords: _words,
    nameKey: _nameKey,
    ...rest
  } = doc;
  return { id: _id, ...rest } as WireDoc;
}

const change = (cfg: MasterConfig, doc: StoredDoc): WireChange => ({
  collection: cfg.collection,
  doc: toWire(doc),
});
const applied = (cfg: MasterConfig, doc: StoredDoc): ApplyResult => ({
  status: "applied",
  docs: [change(cfg, doc)],
});

export async function masterCreate(
  ctx: ServerCtx,
  cfg: MasterConfig,
  id: string,
  fields: Record<string, unknown>,
): Promise<ApplyResult> {
  const col = ctx.db.collection<StoredDoc>(cfg.collection);
  const existing = await col.findOne({ _id: id }, { session: ctx.session });
  if (existing) {
    // Same id again means the same record (a client-side retry of a different operation id).
    return existing.storeId === ctx.storeId
      ? applied(cfg, existing)
      : { status: "rejected", error: "ID_COLLISION" };
  }

  const syncSeq = await allocSeq(ctx.db, ctx.session, ctx.storeId);
  const doc: StoredDoc = {
    ...fields,
    _id: id,
    storeId: ctx.storeId,
    version: 1,
    fieldVersions: Object.fromEntries(
      Object.keys(fields).map((field) => [field, 1]),
    ),
    createdAt: ctx.opCreatedAt,
    updatedAt: ctx.opCreatedAt,
    createdBy: ctx.actorUserId,
    deviceId: ctx.deviceId,
    deletedAt: null,
    syncSeq,
  };
  Object.assign(doc, cfg.derive?.(doc));
  await col.insertOne(doc, { session: ctx.session });
  return applied(cfg, doc);
}

export async function masterUpdate(
  ctx: ServerCtx,
  cfg: MasterConfig,
  id: string,
  baseVersion: number,
  changes: Record<string, unknown>,
  /** Runs inside the transaction after the change is written (e.g. to record an audit line). */
  onApplied?: (
    before: StoredDoc,
    applied: Record<string, unknown>,
  ) => Promise<void>,
): Promise<ApplyResult> {
  const col = ctx.db.collection<StoredDoc>(cfg.collection);
  const doc = await col.findOne(
    { _id: id, storeId: ctx.storeId },
    { session: ctx.session },
  );
  if (!doc) return { status: "rejected", error: "NOT_FOUND" };
  if (doc.deletedAt)
    return { status: "rejected", error: "DELETED", docs: [change(cfg, doc)] };

  const effective = { ...changes };
  if (doc.version !== baseVersion) {
    const clashing = Object.keys(changes).filter(
      (field) => (doc.fieldVersions?.[field] ?? doc.version) > baseVersion,
    );
    if (clashing.some((field) => cfg.criticalFields.includes(field))) {
      return { status: "conflict", docs: [change(cfg, doc)] };
    }
    if (ctx.opCreatedAt < doc.updatedAt) {
      for (const field of clashing) delete effective[field]; // the newer server value wins
    }
  }
  if (Object.keys(effective).length === 0) return applied(cfg, doc);

  const version = doc.version + 1;
  const syncSeq = await allocSeq(ctx.db, ctx.session, ctx.storeId);
  const updated = await col.findOneAndUpdate(
    { _id: id, storeId: ctx.storeId },
    {
      $set: {
        ...effective,
        ...(cfg.derive ? cfg.derive({ ...doc, ...effective }) : {}),
        ...Object.fromEntries(
          Object.keys(effective).map((field) => [
            `fieldVersions.${field}`,
            version,
          ]),
        ),
        version,
        syncSeq,
        updatedAt:
          ctx.opCreatedAt > doc.updatedAt ? ctx.opCreatedAt : doc.updatedAt,
      },
    },
    { returnDocument: "after", session: ctx.session },
  );
  await onApplied?.(doc, effective);
  return applied(cfg, updated ?? doc);
}

export async function masterDelete(
  ctx: ServerCtx,
  cfg: MasterConfig,
  id: string,
): Promise<ApplyResult> {
  const col = ctx.db.collection<StoredDoc>(cfg.collection);
  const doc = await col.findOne(
    { _id: id, storeId: ctx.storeId },
    { session: ctx.session },
  );
  if (!doc) return { status: "rejected", error: "NOT_FOUND" };
  if (doc.deletedAt) return applied(cfg, doc); // already deleted: idempotent
  // Money still owed (or owed back) would drop out of every list and could no longer be settled.
  if (
    (cfg.collection === "customers" || cfg.collection === "suppliers") &&
    Number(doc.balance ?? 0) !== 0
  )
    return { status: "rejected", error: "HAS_BALANCE" };

  const version = doc.version + 1;
  const syncSeq = await allocSeq(ctx.db, ctx.session, ctx.storeId);
  const updated = await col.findOneAndUpdate(
    { _id: id, storeId: ctx.storeId },
    {
      $set: {
        deletedAt: ctx.opCreatedAt,
        "fieldVersions.deletedAt": version,
        version,
        syncSeq,
        updatedAt:
          ctx.opCreatedAt > doc.updatedAt ? ctx.opCreatedAt : doc.updatedAt,
      },
    },
    { returnDocument: "after", session: ctx.session },
  );
  return applied(cfg, updated ?? doc);
}
