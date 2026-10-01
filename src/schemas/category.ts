import { z } from "zod";
import { idSchema } from "./common";

// Messages are i18n keys in the "validation" namespace.
const name = z.string().trim().min(1, { error: "required" }).max(80);
const nameBn = z.string().trim().max(80);
const description = z.string().trim().max(500);

/** The editable fields of a category, as the form and the sync payload both see them. */
export const categoryFieldsSchema = z.object({
  name,
  nameBn: nameBn.default(""),
  description: description.default(""),
  isActive: z.boolean().default(true),
});
export type CategoryFields = z.infer<typeof categoryFieldsSchema>;

export const categoryFormSchema = z.object({ name, nameBn, description });
export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export const categoryChangesSchema = z
  .object({ name, nameBn, description, isActive: z.boolean() })
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, { error: "required" });
export type CategoryChanges = z.infer<typeof categoryChangesSchema>;

export const CATEGORY_FIELDS = [
  "name",
  "nameBn",
  "description",
  "isActive",
] as const;

// Command inputs (what the UI passes) and payloads (what is queued and sent to the server).
export const categoryCreateInput = categoryFieldsSchema.extend({
  id: idSchema,
});
export const categoryCreatePayload = categoryCreateInput;

export const categoryUpdateInput = z.object({
  id: idSchema,
  changes: categoryChangesSchema,
});
export const categoryUpdatePayload = categoryUpdateInput.extend({
  baseVersion: z.number().int().min(0),
});

export const categoryDeleteInput = z.object({ id: idSchema });
export const categoryDeletePayload = categoryDeleteInput.extend({
  baseVersion: z.number().int().min(0),
});
