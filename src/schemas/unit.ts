import { z } from "zod";
import { isDefaultUnit } from "@/lib/units";

/** The code of a unit: a built-in one ("kg") or one the shop added ("u_<id>"). */
export const unitCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_]+$/);

const decimals = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

// Messages are i18n keys in the "validation" namespace.
const baseUnit = z.object({
  code: unitCodeSchema,
  /** The shop's name for it. Empty is only allowed for a built-in unit (it keeps its default name). */
  name: z.string().trim().max(40),
  decimals,
  removed: z.boolean().default(false),
});

export const unitSaveInput = baseUnit.refine(
  (u) => u.name.length > 0 || isDefaultUnit(u.code),
  { path: ["name"], error: "required" },
);
export const unitSavePayload = baseUnit
  .extend({ baseVersion: z.number().int().min(0) })
  .refine((u) => u.name.length > 0 || isDefaultUnit(u.code), {
    path: ["name"],
    error: "required",
  });
