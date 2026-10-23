import { z } from "zod";
import { computeTotals } from "@/lib/sale-math";
import { idSchema } from "./common";
import { unitCodeSchema } from "./unit";

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
  unit: unitCodeSchema,
  /** Milli-units. */
  qty: z.number().int().min(1).max(1_000_000_000_000),
  /** What the product was listed at when added; a different unitPrice is a price override. */
  listPrice: money,
  unitPrice: money,
  /**
   * Cost at the time of sale (for profit reports). A cashier's screen does not know it (purchase
   * prices are hidden from cashiers), so it may be missing: the server uses its own record.
   */
  unitCost: money.default(0),
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
  /** Money handed over. The sale keeps it, so the receipt can show what was received and the change. */
  tendered: money.default(0),
  /** Paid from the customer's store credit (what they had paid ahead). Needs a customer. */
  creditUsed: money.default(0),
  /**
   * Money handed over beyond the bill that is kept on the customer's account instead of given back
   * as change: it comes off what they owe, or becomes their advance. Saved as an ordinary payment.
   */
  toAccount: money.default(0),
  paymentMethod: z.enum(PAYMENT_METHODS).default("cash"),
  notes: text(300).default(""),
});

/** Whatever is not paid becomes the customer's due, so there must be a customer to owe it. */
const needsCustomerForDue = (
  sale: z.infer<typeof saleBase>,
  ctx: z.RefinementCtx,
) => {
  const { due, creditUsed } = computeTotals(
    sale.lines,
    sale.discount,
    sale.tendered,
    sale.creditUsed,
  );
  if ((due > 0 || creditUsed > 0 || sale.toAccount > 0) && !sale.customerId)
    ctx.addIssue({
      code: "custom",
      path: ["customerId"],
      message: "customerForDue",
    });
};

export const saleCreateInput = saleBase.superRefine(needsCustomerForDue);
/** The device adds the invoice number inside the same transaction that numbers it. */
export const saleCreatePayload = saleBase
  .extend({
    invoiceNo: z.string().min(1).max(40),
    /** The buyer's phone at the time of sale (copied from the customer by whoever applies the sale). */
    customerPhone: text(30).default(""),
  })
  .superRefine(needsCustomerForDue);

export const saleVoidInput = z.object({
  saleId: idSchema,
  reason: text(200).default(""),
  /** Also cancel the extra this sale kept on the customer's account (a payment of its own). */
  voidPayment: z.boolean().default(false),
});
/** The device fills in what the sale touched so unsynced voids can be replayed on screen. */
export const saleVoidPayload = saleVoidInput.extend({
  customerId: idSchema.nullable(),
  due: money,
  /** The amount of the kept-on-account payment cancelled together with the sale (0 when none). */
  paymentAmount: money.optional(),
  /** What goes back into stock: the goods not already returned (none, if all of it had come back). */
  lines: z.array(
    z.object({ productId: idSchema, qty: z.number().int().min(1) }),
  ),
});
