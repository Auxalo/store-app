import { z } from "zod";
import { idSchema } from "./common";

const text = (max: number) => z.string().trim().max(max);

// Validators WITHOUT defaults (edits are built from these; see the note in schemas/product.ts).
const shape = {
  name: text(120).min(1, { error: "required" }),
  phone: text(30),
  email: text(120),
  address: text(200),
  contactPerson: text(120),
  notes: text(500),
};

export const supplierFieldsSchema = z.object({
  ...shape,
  phone: shape.phone.default(""),
  email: shape.email.default(""),
  address: shape.address.default(""),
  contactPerson: shape.contactPerson.default(""),
  notes: shape.notes.default(""),
});

export const supplierChangesSchema = z
  .object(shape)
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, { error: "required" });

export const supplierCreateInput = supplierFieldsSchema.extend({
  id: idSchema,
});
export const supplierCreatePayload = supplierCreateInput;

export const supplierUpdateInput = z.object({
  id: idSchema,
  changes: supplierChangesSchema,
});
export const supplierUpdatePayload = supplierUpdateInput.extend({
  baseVersion: z.number().int().min(0),
});

export const supplierDeleteInput = z.object({ id: idSchema });
export const supplierDeletePayload = supplierDeleteInput.extend({
  baseVersion: z.number().int().min(0),
});
