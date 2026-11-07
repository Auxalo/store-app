import { z } from "zod";
import { isBuiltinMethod, isFixedMethod } from "@/lib/payment-methods";

/** The code of a payment method: a built-in one ("cash") or one the shop added ("m_<id>"). */
export const paymentMethodCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_]+$/);

// Messages are i18n keys in the "validation" namespace.
const baseMethod = z.object({
  code: paymentMethodCodeSchema,
  /** The shop's name for it. Empty is only allowed for a built-in method (it keeps its default name). */
  name: z.string().trim().max(40),
  removed: z.boolean().default(false),
});

type MethodFields = z.infer<typeof baseMethod>;

/** Cash, bank and card cannot be removed; a shop's own method needs a name. */
function check(m: MethodFields, ctx: z.RefinementCtx) {
  if (m.name.length === 0 && !isBuiltinMethod(m.code))
    ctx.addIssue({ code: "custom", path: ["name"], message: "required" });
  if (m.removed && isFixedMethod(m.code))
    ctx.addIssue({ code: "custom", path: ["removed"], message: "required" });
}

export const paymentMethodSaveInput = baseMethod.superRefine(check);
export const paymentMethodSavePayload = baseMethod
  .extend({ baseVersion: z.number().int().min(0) })
  .superRefine(check);
