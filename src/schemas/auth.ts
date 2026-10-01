import { z } from "zod";

// Error messages are i18n keys (namespace "validation"); the UI translates them.
export const usernameSchema = z
  .string()
  .trim()
  .min(3, { error: "usernameMin" })
  .max(30, { error: "usernameMax" })
  .regex(/^[a-zA-Z0-9._-]+$/, { error: "usernameFormat" });

export const passwordSchema = z
  .string()
  .min(8, { error: "passwordMin" })
  .max(100, { error: "passwordMax" });

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1, { error: "required" }),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const ownerSignupSchema = z.object({
  storeName: z.string().trim().min(2, { error: "storeNameMin" }).max(80),
  ownerName: z.string().trim().min(2, { error: "ownerNameMin" }).max(80),
  username: usernameSchema,
  password: passwordSchema,
});
export type OwnerSignupInput = z.infer<typeof ownerSignupSchema>;
