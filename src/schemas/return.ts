import { z } from "zod";
import { lineTotal } from "@/lib/qty";
import { UNIT_CODES } from "@/lib/units";
import { idSchema } from "./common";

const money = z
  .number()
  .int({ error: "invalidNumber" })
  .min(0, { error: "invalidNumber" })
  .max(10_000_000_000);
const text = (max: number) => z.string().trim().max(max);

/** cash: money changes hands. credit: it is taken off what the customer owes (or what we owe the supplier). */
export const SETTLEMENTS = ["cash", "credit"] as const;

export const saleReturnLine = z.object({
  /** Position of the line in the original sale. */
  itemIndex: z.number().int().min(0),
  productId: idSchema,
  productName: text(120).min(1),
  productNameBn: text(120).default(""),
  unit: z.enum(UNIT_CODES),
  qty: z.number().int().min(1),
  /** Refund per 1 unit: what the customer paid for it. */
  unitPrice: money,
});

const saleReturnBase = z.object({
  id: idSchema,
  saleId: idSchema,
  lines: z.array(saleReturnLine).min(1).max(200),
  settlement: z.enum(SETTLEMENTS).default("cash"),
  /** Put the goods back into stock (not for damaged goods). */
  restock: z.boolean().default(true),
  notes: text(300).default(""),
});
export const saleReturnInput = saleReturnBase;
/** The device adds the return number and who the sale was for. */
export const saleReturnPayload = saleReturnBase.extend({
  returnNo: z.string().min(1).max(40),
  customerId: idSchema.nullable(),
});

export const purchaseReturnLine = z.object({
  itemIndex: z.number().int().min(0),
  productId: idSchema,
  productName: text(120).min(1),
  productNameBn: text(120).default(""),
  unit: z.enum(UNIT_CODES),
  qty: z.number().int().min(1),
  /** Refund per 1 unit: what we paid for it. */
  unitCost: money,
});

const purchaseReturnBase = z.object({
  id: idSchema,
  purchaseId: idSchema,
  lines: z.array(purchaseReturnLine).min(1).max(200),
  settlement: z.enum(SETTLEMENTS).default("credit"),
  notes: text(300).default(""),
});
export const purchaseReturnInput = purchaseReturnBase;
export const purchaseReturnPayload = purchaseReturnBase.extend({
  returnNo: z.string().min(1).max(40),
  supplierId: idSchema.nullable(),
});

export const returnTotal = (
  lines: Array<{ qty: number; unitPrice?: number; unitCost?: number }>,
) =>
  lines.reduce(
    (sum, l) => sum + lineTotal(l.unitPrice ?? l.unitCost ?? 0, l.qty),
    0,
  );
