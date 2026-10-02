import { can, type Role } from "@/auth/permissions";
import {
  COMMANDS,
  isCommandType,
  OP_SCHEMA_VERSION,
} from "@/commands/definitions";
import type { OpEnvelope, WireChange } from "@/schemas/sync";
import { preparePayload } from "./commands/prepare";
import { applyOperation, type SyncDeps } from "./sync/push";

export interface OnlineRequest {
  /** Chosen by the browser and reused when it retries, so one tap is never applied twice. */
  operationId: string;
  type: string;
  input: unknown;
  /** For edits and deletes: the version the person was looking at. */
  baseVersion?: number;
}

export type OnlineResult =
  | { ok: true; status: "applied" | "duplicate"; docs: WireChange[] }
  | {
      ok: false;
      status: "invalid" | "forbidden" | "rejected" | "conflict" | "retry";
      code: string;
      docs?: WireChange[];
    };

/**
 * Applies something a person did while online. The same handlers and the same exactly-once
 * guarantee as an operation sent from a device; only the payload is built here, on the server.
 * Retrying with the same `operationId` returns the same result (and the same document number).
 */
export async function runOnlineCommand(
  deps: SyncDeps,
  actor: { id: string; role: Role; storeId: string; deviceId: string },
  request: OnlineRequest,
): Promise<OnlineResult> {
  if (!isCommandType(request.type))
    return { ok: false, status: "invalid", code: "UNKNOWN_COMMAND" };
  const type = request.type;
  const def = COMMANDS[type];

  const input = def.input.safeParse(request.input);
  if (!input.success)
    return { ok: false, status: "invalid", code: "INVALID_INPUT" };
  if (!can(actor.role, def.permission))
    return { ok: false, status: "forbidden", code: "FORBIDDEN" };

  const op: OpEnvelope = {
    operationId: request.operationId,
    type,
    schemaVersion: OP_SCHEMA_VERSION,
    payload: null,
    actorUserId: actor.id,
    deviceId: actor.deviceId,
    // The server's clock, not the browser's: the month in a document number depends on it.
    createdAt: new Date().toISOString(),
  };

  const prepare = preparePayload[type] as (
    ctx: Parameters<(typeof preparePayload)["category.create"]>[0],
    input: unknown,
    baseVersion?: number,
  ) => Promise<unknown>;
  const result = await applyOperation(
    deps,
    { storeId: actor.storeId, deviceId: actor.deviceId },
    op,
    actor.role,
    undefined as never,
    (ctx) => prepare(ctx, input.data, request.baseVersion),
  );

  switch (result.status) {
    case "applied":
    case "duplicate":
      return { ok: true, status: result.status, docs: result.docs };
    case "conflict":
      return {
        ok: false,
        status: "conflict",
        code: "CONFLICT",
        docs: result.docs,
      };
    case "rejected":
      return {
        ok: false,
        status: result.error === "FORBIDDEN" ? "forbidden" : "rejected",
        code: result.error,
        docs: result.docs,
      };
    default:
      return { ok: false, status: "retry", code: "SERVER_BUSY" };
  }
}
