import { z } from "zod";
import { idSchema } from "./common";

/**
 * A balance a customer or supplier already had before the shop started using the app: money a
 * customer owes (positive), money owed to a supplier (positive), or an advance (negative). It is a
 * ledger entry on the party and nothing else, so it shows up in dues but is never counted as a sale
 * or a purchase in any report.
 */
export const openingBalanceInput = z.object({
  id: idSchema,
  partyType: z.enum(["customer", "supplier"]),
  partyId: idSchema,
  /** Poisha, signed, never zero. */
  amount: z
    .number()
    .int({ error: "invalidNumber" })
    .min(-10_000_000_000, { error: "invalidNumber" })
    .max(10_000_000_000, { error: "invalidNumber" })
    .refine((n) => n !== 0, { error: "invalidNumber" }),
  note: z.string().trim().max(200).default(""),
});
export const openingBalancePayload = openingBalanceInput;
