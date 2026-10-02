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
  customerCreateInput,
  customerCreatePayload,
  customerDeleteInput,
  customerDeletePayload,
  customerUpdateInput,
  customerUpdatePayload,
} from "@/schemas/customer";
import {
  expenseCreateInput,
  expenseCreatePayload,
  expenseVoidInput,
  expenseVoidPayload,
} from "@/schemas/expense";
import { openingBalanceInput, openingBalancePayload } from "@/schemas/opening";
import { paymentInput, paymentPayload } from "@/schemas/payment";
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
import { purchaseCreateInput, purchaseCreatePayload } from "@/schemas/purchase";
import {
  purchaseReturnInput,
  purchaseReturnPayload,
  saleReturnInput,
  saleReturnPayload,
} from "@/schemas/return";
import {
  saleCreateInput,
  saleCreatePayload,
  saleVoidInput,
  saleVoidPayload,
} from "@/schemas/sale";
import { settingSetInput, settingSetPayload } from "@/schemas/setting";
import {
  supplierCreateInput,
  supplierCreatePayload,
  supplierDeleteInput,
  supplierDeletePayload,
  supplierUpdateInput,
  supplierUpdatePayload,
} from "@/schemas/supplier";

/** Bump when a payload shape changes incompatibly; the server rejects versions it cannot read. */
export const OP_SCHEMA_VERSION = 1;

/** Collections that sync both ways. Each has a Dexie table and a Mongo collection of the same name. */
export const SYNC_COLLECTIONS = [
  "categories",
  "settings",
  "products",
  "stockMovements",
  "customers",
  "sales",
  "ledgerEntries",
  "suppliers",
  "purchases",
  "payments",
  "expenses",
  "returns",
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
  "customer.create": {
    collection: "customers",
    permission: "sale.create",
    input: customerCreateInput,
    payload: customerCreatePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "customer.update": {
    collection: "customers",
    permission: "sale.create",
    input: customerUpdateInput,
    payload: customerUpdatePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "customer.delete": {
    collection: "customers",
    permission: "product.edit",
    input: customerDeleteInput,
    payload: customerDeletePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "sale.create": {
    collection: "sales",
    permission: "sale.create",
    input: saleCreateInput,
    payload: saleCreatePayload,
    // The sale, every product whose stock it moves, and the customer who may owe the balance.
    entityIds: (p: {
      id: string;
      customerId: string | null;
      lines: Array<{ productId: string }>;
    }) => [
      p.id,
      ...new Set(p.lines.map((l) => l.productId)),
      ...(p.customerId ? [p.customerId] : []),
    ],
  },
  "sale.void": {
    collection: "sales",
    permission: "sale.void",
    input: saleVoidInput,
    payload: saleVoidPayload,
    entityIds: (p: {
      saleId: string;
      customerId: string | null;
      lines: Array<{ productId: string }>;
    }) => [
      p.saleId,
      ...new Set(p.lines.map((l) => l.productId)),
      ...(p.customerId ? [p.customerId] : []),
    ],
  },
  "supplier.create": {
    collection: "suppliers",
    permission: "purchase.manage",
    input: supplierCreateInput,
    payload: supplierCreatePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "supplier.update": {
    collection: "suppliers",
    permission: "purchase.manage",
    input: supplierUpdateInput,
    payload: supplierUpdatePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "supplier.delete": {
    collection: "suppliers",
    permission: "purchase.manage",
    input: supplierDeleteInput,
    payload: supplierDeletePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "purchase.create": {
    collection: "purchases",
    permission: "purchase.manage",
    input: purchaseCreateInput,
    payload: purchaseCreatePayload,
    entityIds: (p: {
      id: string;
      supplierId: string | null;
      lines: Array<{ productId: string }>;
    }) => [
      p.id,
      ...new Set(p.lines.map((l) => l.productId)),
      ...(p.supplierId ? [p.supplierId] : []),
    ],
  },
  // Money in from a customer (a due being collected) and money out to a supplier.
  "payment.collect": {
    collection: "payments",
    permission: "sale.create",
    input: paymentInput,
    payload: paymentPayload,
    entityIds: (p: { id: string; partyId: string }) => [p.id, p.partyId],
  },
  "payment.pay": {
    collection: "payments",
    permission: "purchase.manage",
    input: paymentInput,
    payload: paymentPayload,
    entityIds: (p: { id: string; partyId: string }) => [p.id, p.partyId],
  },
  // A balance a customer or supplier already had before using the app (owner and manager only).
  "party.openingBalance": {
    collection: "ledgerEntries",
    permission: "opening.manage",
    input: openingBalanceInput,
    payload: openingBalancePayload,
    entityIds: (p: { id: string; partyId: string }) => [p.id, p.partyId],
  },
  "expense.create": {
    collection: "expenses",
    permission: "expense.manage",
    input: expenseCreateInput,
    payload: expenseCreatePayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "expense.void": {
    collection: "expenses",
    permission: "expense.manage",
    input: expenseVoidInput,
    payload: expenseVoidPayload,
    entityIds: (p: { id: string }) => [p.id],
  },
  "saleReturn.create": {
    collection: "returns",
    permission: "sale.void",
    input: saleReturnInput,
    payload: saleReturnPayload,
    entityIds: (p: {
      id: string;
      customerId: string | null;
      lines: Array<{ productId: string }>;
    }) => [
      p.id,
      ...new Set(p.lines.map((l) => l.productId)),
      ...(p.customerId ? [p.customerId] : []),
    ],
  },
  "purchaseReturn.create": {
    collection: "returns",
    permission: "purchase.manage",
    input: purchaseReturnInput,
    payload: purchaseReturnPayload,
    entityIds: (p: {
      id: string;
      supplierId: string | null;
      lines: Array<{ productId: string }>;
    }) => [
      p.id,
      ...new Set(p.lines.map((l) => l.productId)),
      ...(p.supplierId ? [p.supplierId] : []),
    ],
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
/** What callers may pass (defaults not yet applied). Handlers receive the parsed CommandInput. */
export type CommandArgs<T extends CommandType> = z.input<
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
