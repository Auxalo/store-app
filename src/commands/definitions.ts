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
import {
  productCreateInput,
  productCreatePayload,
  productDeleteInput,
  productDeletePayload,
  productUpdateInput,
  productUpdatePayload,
  stockAdjustInput,
  stockAdjustPayload,
} from "@/schemas/product";
import { settingSetInput, settingSetPayload } from "@/schemas/setting";

/** Bump when a payload shape changes incompatibly; the server rejects versions it cannot read. */
export const OP_SCHEMA_VERSION = 1;

/** Collections that sync both ways. Each has a Dexie table and a Mongo collection of the same name. */
export const SYNC_COLLECTIONS = [
  "categories",
  "settings",
  "products",
  "stockMovements",
] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

interface CommandDef {
  /** The collection of the record this command is "about" (used to clean up a rejected create). */
  collection: SyncCollection;
  permission: Permission;
  /** What the UI passes to runCommand. */
  input: z.ZodType;
  /** What is queued and sent; the local handler may add fields such as baseVersion. */
  payload: z.ZodType;
  /**
   * Every record the operation changes, primary one first. Used to re-apply unsynced operations
   * on top of server data (so a pull never makes a pending change disappear).
   */
  entityIds: (payload: never) => string[];
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
    entityIds: (p: { id: string }) => [p.id],
  },
  "category.update": {
    collection: "categories",
    permission: "product.edit",
    input: categoryUpdateInput,
    payload: categoryUpdatePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "category.delete": {
    collection: "categories",
    permission: "product.edit",
    input: categoryDeleteInput,
    payload: categoryDeletePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "product.create": {
    collection: "products",
    permission: "product.create",
    input: productCreateInput,
    payload: productCreatePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "product.update": {
    collection: "products",
    permission: "product.edit",
    input: productUpdateInput,
    payload: productUpdatePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "product.delete": {
    collection: "products",
    permission: "product.edit",
    input: productDeleteInput,
    payload: productDeletePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "stock.adjust": {
    collection: "products",
    permission: "stock.adjust",
    input: stockAdjustInput,
    payload: stockAdjustPayload,
    entityIds: (p: { productId: string }) => [p.productId],
  },
  "setting.set": {
    collection: "settings",
    permission: "settings.manage",
    input: settingSetInput,
    payload: settingSetPayload,
    entityIds: (p: { key: string }) => [p.key],
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

export function entityIdsOf(type: CommandType, payload: unknown): string[] {
  return (COMMANDS[type].entityIds as (p: unknown) => string[])(payload);
}
