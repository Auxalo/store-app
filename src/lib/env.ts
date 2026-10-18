import "server-only";
import { z } from "zod";

const schema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().min(1).default("store_app"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url().optional(),
  // Email (all optional: without them "forgot password" says to contact the developer).
  // MAIL_TRANSPORT=outbox keeps mails in the database instead of sending them (tests, local tries).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_TRANSPORT: z.enum(["smtp", "outbox"]).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** Validated lazily so `next build` of the static pages works without secrets. */
export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new Error(
        `Invalid server environment — ${problems}. See .env.example.`,
      );
    }
    // In production the public address is needed (cookies and trusted origins depend on it). Preview
    // deployments on Vercel get their own address, so they are allowed to leave it out.
    const preview =
      process.env.VERCEL_ENV === "preview" ||
      process.env.VERCEL_ENV === "development";
    if (
      process.env.NODE_ENV === "production" &&
      !preview &&
      !parsed.data.BETTER_AUTH_URL
    )
      throw new Error(
        "Invalid server environment — BETTER_AUTH_URL is required in production (your public https address). See .env.example.",
      );
    cached = parsed.data;
  }
  return cached;
}
