import { z } from "zod";
import { computeTotals } from "@/lib/sale-math";
import { UNIT_CODES } from "@/lib/units";
import { idSchema } from "./common";

const money = z
  .number()
  .int({ error: "invalidNumber" })
  .min(0, { error: "invalidNumber" })
  .max(10_000_000_000);
const text = (max: number) => z.string().trim().max(max);

export const PAYMENT_METHODS = [
  "cash",
  "bkash",
  "nagad",
  "rocket",
  "card",
  "bank",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** One line of a sale as entered at the counter. Product details are copied (a snapshot) so the receipt never changes later. */
export const saleLineInput = z.object({
  productId: idSchema,
  productName: text(120).min(1),
  productNameBn: text(120).default(""),
  unit: z.enum(UNIT_CODES),
  /** Milli-units. */
  qty: z.number().int().min(1).max(1_000_000_000_000),
  /** What the product was listed at when added; a different unitPrice is a price override. */
  listPrice: money,
  unitPrice: money,
  /** Cost at the time of sale (for profit reports). */
  unitCost: money,
  /** Poisha off this line. */
  discount: money.default(0),
});
export type SaleLineInput = z.infer<typeof saleLineInput>;

const saleBase = z.object({
  id: idSchema,
  customerId: idSchema.nullable().default(null),
  /** Copied from the customer so the receipt keeps the name even if it is edited later. */
  customerName: text(120).default(""),
  lines: z.array(saleLineInput).min(1).max(200),
  /** Cart-level discount in poisha. */
  discount: money.default(0),
  /** Money handed over; anything above the total is change and is not recorded. */
  tendered: money.default(0),
  paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  notes: text(300).default(""),
});

/** Whatever is not paid becomes the customer's due, so there must be a customer to owe it. */
const needsCustomerForDue = (
  sale: z.infer<typeof saleBase>,
  ctx: z.RefinementCtx,
) => {
  const { due } = computeTotals(sale.lines, sale.discount, sale.tendered);
  if (due > 0 && !sale.customerId)
    ctx.addIssue({
      code: "custom",
      path: ["customerId"],
      message: "customerForDue",
    });
};

export const saleCreateInput = saleBase.superRefine(needsCustomerForDue);
/** The device adds the invoice number inside the same transaction that numbers it. */
export const saleCreatePayload = saleBase
  .extend({ invoiceNo: z.string().min(1).max(40) })
  .superRefine(needsCustomerForDue);

export const saleVoidInput = z.object({
  saleId: idSchema,
  reason: text(200).default(""),
});
/** The device fills in what the sale touched so unsynced voids can be replayed on screen. */
export const saleVoidPayload = saleVoidInput.extend({
  customerId: idSchema.nullable(),
  due: money,
  lines: z
    .array(z.object({ productId: idSchema, qty: z.number().int().min(1) }))
    .min(1),
});
