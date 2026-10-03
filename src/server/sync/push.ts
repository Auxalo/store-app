import { type Db, type MongoClient, ObjectId } from "mongodb";
import { can, isRole, type Role } from "@/auth/permissions";
import {
  COMMANDS,
  isCommandType,
  OP_SCHEMA_VERSION,
} from "@/commands/definitions";
import {
  type OpEnvelope,
  opEnvelopeSchema,
  type PushResponse,
  type PushResult,
  type WireChange,
} from "@/schemas/sync";
import { serverCommands } from "../commands/registry";
import type { ApplyResult, ServerCtx } from "../commands/types";
import { COL } from "./collections";
import { withTxn } from "./txn";

export interface SyncDeps {
  client: MongoClient;
  db: Db;
}

export interface DeviceAuth {
  storeId: string;
  deviceId: string;
}

interface Actor {
  role: Role;
}

interface AppliedOp {
  _id: string;
  storeId: string;
  type: string;
  docs: WireChange[];
  appliedAt: Date;
}

/** Looks the actor up in the database: the role is never taken from the device. */
async function loadActor(
  db: Db,
  storeId: string,
  userId: string,
): Promise<Actor | null> {
  if (!ObjectId.isValid(userId)) return null;
  const user = await db
    .collection(COL.users)
    .findOne({ _id: new ObjectId(userId) });
  if (
    !user ||
    user.storeId !== storeId ||
    user.isActive === false ||
    !isRole(user.role)
  )
    return null;
  return { role: user.role };
}

const isDuplicateKey = (error: unknown) =>
  (error as { code?: number })?.code === 11000;

/**
 * Applies one operation exactly once.
 *
 * The idempotency record (`appliedOps`, keyed by operationId) is written in the same transaction
 * as the business change. A retry therefore finds either the record (→ duplicate, nothing changes)
 * or neither (→ the earlier attempt never committed, so it is applied now).
 */
/** Thrown while preparing a payload to refuse the operation with a reason (nothing is written). */
export class PrepareRejection extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

/** Aborts the transaction but still reports what the handler decided (so numbers are not used up). */
class AbortWith extends Error {
  constructor(public readonly result: ApplyResult) {
    super("ABORT");
  }
}

export async function applyOperation(
  deps: SyncDeps,
  device: DeviceAuth,
  op: OpEnvelope,
  role: Role,
  payload: never,
  /**
   * Online commands build their payload on the server, inside the same transaction as the change,
   * so a document number is only used up if the document is really saved.
   */
  prepare?: (ctx: ServerCtx) => Promise<unknown>,
) {
  const applied = deps.db.collection<AppliedOp>(COL.appliedOps);

  for (let attempt = 0; attempt < 3; attempt++) {
    const prior = await applied.findOne({
      _id: op.operationId,
      storeId: device.storeId,
    });
    if (prior) return { status: "duplicate" as const, docs: prior.docs };

    try {
      return await withTxn(deps.client, async (session) => {
        const ctx: ServerCtx = {
          db: deps.db,
          session,
          storeId: device.storeId,
          actorUserId: op.actorUserId,
          role,
          deviceId: op.deviceId,
          opCreatedAt: op.createdAt,
          scratch: new Map(),
        };
        const handler = serverCommands[
          op.type as keyof typeof serverCommands
        ] as (ctx: ServerCtx, payload: never) => Promise<ApplyResult>;
        let toApply: never = payload;
        if (prepare) {
          try {
            const raw = await prepare(ctx);
            const checked =
              COMMANDS[op.type as keyof typeof COMMANDS].payload.safeParse(raw);
            if (!checked.success)
              return {
                status: "rejected",
                error: "INVALID_PAYLOAD",
              } as ApplyResult;
            toApply = checked.data as never;
          } catch (error) {
            if (error instanceof PrepareRejection)
              return { status: "rejected", error: error.code } as ApplyResult;
            throw error;
          }
        }
        const result = await handler(ctx, toApply);
        if (prepare && result.status !== "applied") throw new AbortWith(result);
        if (result.status === "applied") {
          await applied.insertOne(
            {
              _id: op.operationId,
              storeId: device.storeId,
              type: op.type,
              docs: result.docs,
              appliedAt: new Date(),
            },
            { session },
          );
        }
        return result;
      });
    } catch (error) {
      if (error instanceof AbortWith) return error.result;
      if (isDuplicateKey(error)) {
        // The database's own backstop for codes: another live product of this shop already has this
        // SKU or barcode. A real answer for the person (the sync screen explains it), not a retry.
        const pattern =
          (error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
        if (pattern.sku)
          return { status: "rejected", error: "DUPLICATE_SKU" } as ApplyResult;
        if (pattern.barcode)
          return {
            status: "rejected",
            error: "DUPLICATE_BARCODE",
          } as ApplyResult;
        // Otherwise a concurrent retry of the same operation committed first: loop and report it
        // as a duplicate.
        continue;
      }
      throw error;
    }
  }
  return { status: "retry" as const };
}

async function processOp(
  deps: SyncDeps,
  device: DeviceAuth,
  op: OpEnvelope,
): Promise<PushResult> {
  const reject = (error: string): PushResult => ({
    operationId: op.operationId,
    status: "rejected",
    error,
  });

  if (op.deviceId !== device.deviceId) return reject("DEVICE_MISMATCH");
  if (!isCommandType(op.type)) return reject("UNKNOWN_COMMAND");
  if (op.schemaVersion > OP_SCHEMA_VERSION)
    return reject("UNSUPPORTED_SCHEMA_VERSION");

  const def = COMMANDS[op.type];
  const parsed = def.payload.safeParse(op.payload);
  if (!parsed.success) return reject("INVALID_PAYLOAD");

  const actor = await loadActor(deps.db, device.storeId, op.actorUserId);
  if (!actor) return reject("ACTOR_NOT_ALLOWED");
  if (!can(actor.role, def.permission)) return reject("FORBIDDEN");

  const result = await applyOperation(
    deps,
    device,
    op,
    actor.role,
    parsed.data as never,
  );
  if (result.status === "retry")
    return { operationId: op.operationId, status: "retry" };
  if (result.status === "rejected") {
    return {
      operationId: op.operationId,
      status: "rejected",
      error: result.error,
      docs: result.docs,
    };
  }
  return {
    operationId: op.operationId,
    status: result.status,
    docs: result.docs,
  };
}

/** The database or the network failed for a moment: asking again later can work. */
function isTransient(error: unknown): boolean {
  const e = error as {
    name?: string;
    hasErrorLabel?: (label: string) => boolean;
  };
  return (
    (typeof e?.name === "string" && e.name.startsWith("Mongo")) ||
    e?.hasErrorLabel?.("TransientTransactionError") === true
  );
}

const idOf = (raw: unknown): string =>
  typeof (raw as { operationId?: unknown } | null)?.operationId === "string"
    ? String((raw as { operationId: string }).operationId)
    : "";

/**
 * Processes a batch in order. If one operation hits a transient problem, every later operation is
 * answered `retry` too, so a dependent change (an edit after its create) can never run ahead.
 *
 * An operation that is malformed, or that fails for a reason that will never change (a record it
 * cannot read), is refused on its own: it must not hold up everything behind it for ever.
 */
export async function handlePush(
  deps: SyncDeps,
  device: DeviceAuth,
  request: { deviceId: string; appVersion: string; ops: unknown[] },
): Promise<PushResponse> {
  const results: PushResult[] = [];
  let halted = false;

  for (const raw of request.ops) {
    if (halted) {
      results.push({ operationId: idOf(raw), status: "retry" });
      continue;
    }
    const parsed = opEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({
        operationId: idOf(raw),
        status: "rejected",
        error: "INVALID_OP",
      });
      continue;
    }
    const op = parsed.data;
    try {
      const result = await processOp(deps, device, op);
      results.push(result);
      if (result.status === "retry") halted = true;
    } catch (error) {
      console.error("sync push: operation failed", op.operationId, error);
      if (isTransient(error)) {
        results.push({ operationId: op.operationId, status: "retry" });
        halted = true;
      } else {
        results.push({
          operationId: op.operationId,
          status: "rejected",
          error: "INTERNAL_ERROR",
        });
      }
    }
  }
  return { serverTime: new Date().toISOString(), results };
}
