import { z } from "zod";
import { normalizeTrxId } from "@/billing/state";
import { bnToEn } from "@/lib/numerals";
import { isValidPhone, normalizePhone } from "@/lib/phone";

// Error messages are i18n keys (namespace "validation" or "billing"); the UI translates them.

/** bKash and Nagad transaction ids: letters and digits (8 to 12 of them in practice). */
export const trxIdSchema = z
  .string()
  .transform((value) => normalizeTrxId(bnToEn(value)))
  .pipe(
    z
      .string()
      .min(6, { error: "trxIdFormat" })
      .max(30, { error: "trxIdFormat" })
      .regex(/^[A-Z0-9]+$/, { error: "trxIdFormat" }),
  );

/** The number the money was sent from. */
export const senderSchema = z
  .string()
  .refine((value) => isValidPhone(value) && normalizePhone(value) !== "", {
    error: "phoneFormat",
  })
  .transform(normalizePhone);

const poisha = z.number().int().positive().max(100_000_000);
const planId = z.string().trim().min(1).max(40);

/** A shop says "I sent the money". */
export const submitPaymentSchema = z.object({
  method: z.enum(["bkash", "nagad"]),
  trxId: trxIdSchema,
  sender: senderSchema,
  amount: poisha,
  planId,
});
export type SubmitPaymentInput = z.infer<typeof submitPaymentSchema>;

/** A Dhaka calendar day, "2026-10-31". */
export const dayKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: "invalidDate" });

/** The operator changes a shop's billing (only what is given changes). */
export const shopBillingSchema = z
  .object({
    mode: z.enum(["off", "free", "paid"]),
    planId: planId.nullable(),
    price: poisha.nullable(),
    graceDays: z.number().int().min(0).max(60).nullable(),
    paidUntil: dayKeySchema.nullable(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { error: "required" });

export const extendSchema = z.object({
  days: z.number().int().min(1).max(366),
  reason: z.string().trim().max(200).default(""),
});

/** A payment the operator records themselves (cash, or one that came in another way). */
export const recordPaymentSchema = z.object({
  amount: poisha,
  method: z.enum(["bkash", "nagad", "cash", "other"]),
  trxId: z.string().trim().max(40).default(""),
  months: z.number().int().min(1).max(36),
  planId: planId.optional(),
  note: z.string().trim().max(200).default(""),
});

export const approveSchema = z.object({
  amount: poisha.optional(),
  months: z.number().int().min(1).max(36).optional(),
});

export const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

export const planSchema = z.object({
  id: planId.regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(40),
  nameBn: z.string().trim().min(1).max(40),
  months: z.number().int().min(1).max(36),
  price: poisha,
  active: z.boolean(),
});

const payToNumber = z
  .string()
  .transform((value) => normalizePhone(bnToEn(value)))
  .pipe(z.string().regex(/^\+?\d{6,15}$/));

export const platformBillingSchema = z.object({
  plans: z
    .array(planSchema)
    .min(1)
    .max(20)
    .refine((plans) => new Set(plans.map((p) => p.id)).size === plans.length, {
      error: "duplicatePlan",
    }),
  payTo: z.object({ bkash: payToNumber, nagad: payToNumber }),
  newShop: z.object({
    mode: z.enum(["off", "free", "paid"]),
    trialDays: z.number().int().min(0).max(365),
  }),
  graceDays: z.number().int().min(0).max(60),
  reminderDays: z.number().int().min(0).max(60),
  provisionalHours: z.number().int().min(0).max(240),
});

/** The operator's own facts about a shop (the shop never sees them), and its name. */
export const shopProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    contactPhone: z
      .string()
      .refine(isValidPhone, { error: "phoneFormat" })
      .transform(normalizePhone),
    adminNote: z.string().trim().max(2000),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { error: "required" });

/** The operator's payment list: by status, by month ("2026-10"), for one shop. */
export const paymentsQuery = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  storeId: z.string().max(64).optional(),
});
