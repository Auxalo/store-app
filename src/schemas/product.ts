import { z } from "zod";
import { UNIT_CODES } from "@/lib/units";
import { idSchema } from "./common";

// Messages are i18n keys in the "validation" namespace.
const money = z
  .number()
  .int({ error: "invalidNumber" })
  .min(0, { error: "invalidNumber" })
  .max(10_000_000_000);
const qty = z
  .number()
  .int({ error: "invalidNumber" })
  .min(0, { error: "invalidNumber" })
  .max(1_000_000_000_000);
const text = (max: number) => z.string().trim().max(max);

// Field validators WITHOUT defaults. Edits are built from these: `.partial()` on a schema that has
// `.default()` values would fill every untouched field with its default and wipe real data.
const shape = {
  name: text(120).min(1, { error: "required" }),
  nameBn: text(120),
  sku: text(60),
  barcode: text(60),
  categoryId: idSchema.nullable(),
  unit: z.enum(UNIT_CODES),
  purchasePrice: money,
  sellingPrice: money,
  lowStockThreshold: qty,
  description: text(500),
  isActive: z.boolean(),
};

/** Prices in poisha, quantities in milli-units (see src/lib/money.ts and qty.ts). */
export const productFieldsSchema = z.object({
  ...shape,
  nameBn: shape.nameBn.default(""),
  sku: shape.sku.default(""),
  barcode: shape.barcode.default(""),
  categoryId: shape.categoryId.default(null),
  unit: shape.unit.default("pcs"),
  purchasePrice: shape.purchasePrice.default(0),
  sellingPrice: shape.sellingPrice.default(0),
  lowStockThreshold: shape.lowStockThreshold.default(0),
  description: shape.description.default(""),
  isActive: shape.isActive.default(true),
});
export type ProductFields = z.infer<typeof productFieldsSchema>;

export const PRODUCT_FIELDS = Object.keys(shape) as Array<keyof ProductFields>;
/** Fields where two devices disagreeing needs a person to decide. */
export const PRODUCT_CRITICAL_FIELDS = [
  "purchasePrice",
  "sellingPrice",
] as const;

export const productChangesSchema = z
  .object(shape)
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, { error: "required" });
export type ProductChanges = z.infer<typeof productChangesSchema>;

export const productCreateInput = productFieldsSchema.extend({
  id: idSchema,
  /** Stock on hand when the product is created (becomes an "opening" movement). */
  openingStock: qty.default(0),
  openingMovementId: idSchema,
});
export const productCreatePayload = productCreateInput;

export const productUpdateInput = z.object({
  id: idSchema,
  changes: productChangesSchema,
});
export const productUpdatePayload = productUpdateInput.extend({
  baseVersion: z.number().int().min(0),
});

export const productDeleteInput = z.object({ id: idSchema });
export const productDeletePayload = productDeleteInput.extend({
  baseVersion: z.number().int().min(0),
});

export const STOCK_MOVEMENT_TYPES = [
  "opening",
  "purchase",
  "sale",
  "sale_return",
  "purchase_return",
  "damage",
  "adjustment",
  "correction",
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** The movement types a person can create by hand from the stock screen. */
export const MANUAL_MOVEMENT_TYPES = [
  "adjustment",
  "damage",
  "correction",
] as const;

export const stockAdjustInput = z.object({
  productId: idSchema,
  movementId: idSchema,
  type: z.enum(MANUAL_MOVEMENT_TYPES),
  /** Signed change in milli-units. Never zero. */
  qtyDelta: z
    .number()
    .int()
    .refine((n) => n !== 0, { error: "invalidNumber" }),
  note: text(200).default(""),
});
export const stockAdjustPayload = stockAdjustInput;
