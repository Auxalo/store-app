import { z } from "zod";
import { passwordSchema, usernameSchema } from "./auth";

/** A PIN hash as produced by `hashPin` on the device (base64 salt and hash). */
export const pinHashSchema = z.object({
  salt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/, "invalid salt"),
  hash: z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "invalid hash"),
});

/** Owners cannot be created or changed here: a store keeps the owner it was created with. */
export const STAFF_ROLES = ["manager", "cashier"] as const;

export const createStaffSchema = z.object({
  name: z.string().trim().min(2, { error: "ownerNameMin" }).max(80),
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(STAFF_ROLES),
  pin: pinHashSchema.optional(),
});

export const updateStaffSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    role: z.enum(STAFF_ROLES),
    isActive: z.boolean(),
    password: passwordSchema,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { error: "required" });

export const setPinSchema = pinHashSchema;
