import { z } from "zod";
import { computeTotals } from "@/lib/sale-math";
import { UNIT_CODES } from "@/lib/units";
import { idSchema } from "./common";
import { PAYMENT_METHODS } from "./sale";

const money = z
  .number()
  .int({ error: "invalidNumber" })
  .min(0, { error: "invalidNumber" })
  .max(10_000_000_000);
const text = (max: number) => z.string().trim().max(max);

export const purchaseLineInput = z.object({
  productId: idSchema,
  productName: text(120).min(1),
  productNameBn: text(120).default(""),
  unit: z.enum(UNIT_CODES),
  /** Milli-units received. */
  qty: z.number().int().min(1).max(1_000_000_000_000),
  /** Poisha paid per 1 unit: more than zero (free stock is added by adjusting stock). */
  unitCost: z
    .number()
    .int({ error: "invalidNumber" })
    .min(1, { error: "invalidNumber" })
    .max(10_000_000_000),
  discount: money.default(0),
});
export type PurchaseLineInput = z.infer<typeof purchaseLineInput>;

/** Purchase lines priced like sale lines (cost plays the part of price), so totals use the same function. */
export const purchaseTotals = (
  lines: Array<{ qty: number; unitCost: number; discount: number }>,
  discount: number,
  paid: number,
) =>
  computeTotals(
    lines.map((l) => ({
      qty: l.qty,
      unitPrice: l.unitCost,
      discount: l.discount,
    })),
    discount,
    paid,
  );

const purchaseBase = z.object({
  id: idSchema,
  supplierId: idSchema.nullable().default(null),
  supplierName: text(120).default(""),
  /** The supplier's own invoice number, if any. */
  invoiceRef: text(60).default(""),
  /** The day the goods arrived (yyyy-mm-dd, in the store's time zone). */
  date: z.iso.date(),
  lines: z.array(purchaseLineInput).min(1).max(200),
  discount: money.default(0),
  paid: money.default(0),
  /**
   * Paid beyond the purchase total and kept on the supplier's account (it comes off what we owe, or
   * becomes an advance with them) instead of being handed back. Saved as an ordinary payment.
   */
  toAccount: money.default(0),
  paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  notes: text(300).default(""),
  /** Set each product's purchase price to what it cost this time. */
  updateCosts: z.boolean().default(true),
});

const needsSupplierForDue = (
  p: z.infer<typeof purchaseBase>,
  ctx: z.RefinementCtx,
) => {
  const { due } = purchaseTotals(p.lines, p.discount, p.paid);
  if ((due > 0 || p.toAccount > 0) && !p.supplierId)
    ctx.addIssue({
      code: "custom",
      path: ["supplierId"],
      message: "supplierForDue",
    });
};

export const purchaseCreateInput =
  purchaseBase.superRefine(needsSupplierForDue);
export const purchaseCreatePayload = purchaseBase
  .extend({ purchaseNo: z.string().min(1).max(40) })
  .superRefine(needsSupplierForDue);

/**
 * Cancels a purchase entered by mistake: its goods leave stock, what it put on the supplier's
 * account comes off, and the money paid on it (and any extra kept on the supplier's account) is
 * cancelled too. It stays on record, marked cancelled. A purchase with returns cannot be cancelled
 * until those returns are cancelled.
 */
export const purchaseVoidInput = z.object({
  purchaseId: idSchema,
  reason: z.string().trim().max(200).default(""),
});
/** The device adds what the purchase had moved, so a cancellation not yet synced shows on screen. */
export const purchaseVoidPayload = purchaseVoidInput.extend({
  supplierId: idSchema.nullable().optional(),
  due: z.number().int().min(0).optional(),
  /** The extra kept on the supplier's account, cancelled with the purchase (0 when none). */
  paymentAmount: z.number().int().min(0).optional(),
  lines: z
    .array(z.object({ productId: idSchema, qty: z.number().int().min(1) }))
    .default([]),
});
