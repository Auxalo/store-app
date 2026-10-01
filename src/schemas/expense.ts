import { z } from "zod";
import { idSchema } from "./common";
import { PAYMENT_METHODS } from "./sale";

export const EXPENSE_CATEGORIES = [
  "rent",
  "electricity",
  "salary",
  "transport",
  "internet",
  "maintenance",
  "food",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const expenseCreateInput = z.object({
  id: idSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z
    .number()
    .int({ error: "invalidNumber" })
    .min(1, { error: "invalidNumber" })
    .max(10_000_000_000),
  description: z.string().trim().max(200).default(""),
  /** yyyy-mm-dd in the store's time zone. */
  date: z.iso.date(),
  method: z.enum(PAYMENT_METHODS).default("cash"),
  notes: z.string().trim().max(300).default(""),
});
export const expenseCreatePayload = expenseCreateInput;

/** Expenses are never edited or deleted; a wrong one is cancelled, and stays on record. */
export const expenseVoidInput = z.object({
  id: idSchema,
  reason: z.string().trim().max(200).default(""),
});
export const expenseVoidPayload = expenseVoidInput;
