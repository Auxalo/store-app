import { z } from "zod";
import { idSchema } from "./common";

const text = (max: number) => z.string().trim().max(max);

// Validators WITHOUT defaults (edits are built from these; see the note in schemas/product.ts).
const shape = {
  name: text(120).min(1, { error: "required" }),
  phone: text(30),
  address: text(200),
  notes: text(500),
};

export const customerFieldsSchema = z.object({
  ...shape,
  phone: shape.phone.default(""),
  address: shape.address.default(""),
  notes: shape.notes.default(""),
});
export type CustomerFields = z.infer<typeof customerFieldsSchema>;

export const customerChangesSchema = z
  .object(shape)
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, { error: "required" });

export const customerCreateInput = customerFieldsSchema.extend({
  id: idSchema,
});
export const customerCreatePayload = customerCreateInput;

export const customerUpdateInput = z.object({
  id: idSchema,
  changes: customerChangesSchema,
});
export const customerUpdatePayload = customerUpdateInput.extend({
  baseVersion: z.number().int().min(0),
});

export const customerDeleteInput = z.object({ id: idSchema });
export const customerDeletePayload = customerDeleteInput.extend({
  baseVersion: z.number().int().min(0),
});
