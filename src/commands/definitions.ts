import type { z } from "zod";
import type { Permission } from "@/auth/permissions";
import {
  categoryCreateInput,
  categoryCreatePayload,
  categoryDeleteInput,
  categoryDeletePayload,
  categoryUpdateInput,
  categoryUpdatePayload,
} from "@/schemas/category";
import { settingSetInput, settingSetPayload } from "@/schemas/setting";

/** Bump when a payload shape changes incompatibly; the server rejects versions it cannot read. */
export const OP_SCHEMA_VERSION = 1;

/** Collections that sync both ways. Each has a Dexie table and a Mongo collection of the same name. */
export const SYNC_COLLECTIONS = ["categories", "settings"] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

interface CommandDef {
  collection: SyncCollection;
  permission: Permission;
  /** What the UI passes to runCommand. */
  input: z.ZodType;
  /** What is queued and sent; the local handler may add fields such as baseVersion. */
  payload: z.ZodType;
  /** The entity the operation targets (used to order and overlay pending operations). */
  entityId: (payload: never) => string;
}

/**
 * Single source of truth for every command: its schemas and required permission.
 * `src/commands/local` (Dexie) and `src/server/commands` (Mongo) each implement every key.
 */
export const COMMANDS = {
  "category.create": {
    collection: "categories",
    permission: "product.create",
    input: categoryCreateInput,
    payload: categoryCreatePayload,
    entityId: (p: { id: string }) => p.id,
  },
  "category.update": {
    collection: "categories",
    permission: "product.edit",
    input: categoryUpdateInput,
    payload: categoryUpdatePayload,
    entityId: (p: { id: string }) => p.id,
  },
  "category.delete": {
    collection: "categories",
    permission: "product.edit",
    input: categoryDeleteInput,
    payload: categoryDeletePayload,
    entityId: (p: { id: string }) => p.id,
  },
  "setting.set": {
    collection: "settings",
    permission: "settings.manage",
    input: settingSetInput,
    payload: settingSetPayload,
    entityId: (p: { key: string }) => p.key,
  },
} as const satisfies Record<string, CommandDef>;

export type CommandType = keyof typeof COMMANDS;
export type CommandInput<T extends CommandType> = z.infer<
  (typeof COMMANDS)[T]["input"]
>;
export type CommandPayload<T extends CommandType> = z.infer<
  (typeof COMMANDS)[T]["payload"]
>;

export function isCommandType(value: string): value is CommandType {
  return Object.hasOwn(COMMANDS, value);
}

export function entityIdOf(type: CommandType, payload: unknown): string {
  return (COMMANDS[type].entityId as (p: unknown) => string)(payload);
}
