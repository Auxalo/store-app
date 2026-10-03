import type { ClientSession, Db } from "mongodb";
import type { Role } from "@/auth/permissions";
import type { CommandPayload, CommandType } from "@/commands/definitions";
import type { WireChange } from "@/schemas/sync";

export interface ServerCtx {
  db: Db;
  session: ClientSession;
  storeId: string;
  actorUserId: string;
  role: Role;
  deviceId: string;
  /** When the action happened on the device (canonical UTC ISO). Used for last-write-wins. */
  opCreatedAt: string;
  /**
   * What the "prepare" step already read inside this transaction (the sold products, the customer),
   * so the handler does not read the same records again. Nothing here may outlive the operation.
   */
  scratch?: Map<string, unknown>;
}

export type ApplyResult =
  | { status: "applied"; docs: WireChange[] }
  | { status: "conflict"; docs: WireChange[] }
  | { status: "rejected"; error: string; docs?: WireChange[] };

export type ServerHandler<T extends CommandType> = (
  ctx: ServerCtx,
  payload: CommandPayload<T>,
) => Promise<ApplyResult>;
