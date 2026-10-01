import { z } from "zod";
import { idSchema } from "./common";
import { PAYMENT_METHODS } from "./sale";

/**
 * Money received from a customer (collecting a due) or paid to a supplier. The same shape serves both;
 * the command name says which. It becomes a payment record plus a ledger entry on the party.
 */
export const paymentInput = z.object({
  id: idSchema,
  partyId: idSchema,
  /** Poisha, more than zero. Paying more than is owed leaves the party with an advance balance. */
  amount: z
    .number()
    .int({ error: "invalidNumber" })
    .min(1, { error: "invalidNumber" })
    .max(10_000_000_000),
  method: z.enum(PAYMENT_METHODS).default("cash"),
  note: z.string().trim().max(200).default(""),
});
export const paymentPayload = paymentInput;
