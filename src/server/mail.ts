import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { serverEnv } from "@/lib/env";
import { getSyncDeps } from "./deps";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Accounts made without an email (staff, older owners) carry this made-up address: never mailed. */
export const SYNTHETIC_EMAIL_SUFFIX = "@users.store-app.invalid";

/** True when a real address can be mailed: SMTP is set up, or mails go to the test outbox. */
export function mailReady(): boolean {
  const env = serverEnv();
  return env.MAIL_TRANSPORT === "outbox" || !!(env.SMTP_HOST && env.MAIL_FROM);
}

let transporter: Transporter | undefined;

function smtp(): Transporter {
  if (!transporter) {
    const env = serverEnv();
    const port = env.SMTP_PORT ?? 587;
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      // 465 is TLS from the start; the usual 587 upgrades with STARTTLS on its own.
      secure: env.SMTP_SECURE === "1" || port === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
      // A slow mail server must not hold a request open for long.
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 8_000,
    });
  }
  return transporter;
}

/**
 * Sends one email. It never throws: a mail that cannot go out must not break signing up or the
 * "forgot password" screen (which also must not tell anyone whether an address has an account).
 * Returns whether it was handed over. Addresses that are not real (see SYNTHETIC_EMAIL_SUFFIX) are
 * skipped. With MAIL_TRANSPORT=outbox the message is stored in the `mailOutbox` collection instead
 * of being sent: that is how the browser tests read the reset link, and how to try the flow locally.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  try {
    if (message.to.endsWith(SYNTHETIC_EMAIL_SUFFIX)) return false;
    const env = serverEnv();
    if (env.MAIL_TRANSPORT === "outbox") {
      const { db } = await getSyncDeps();
      await db.collection("mailOutbox").insertOne({
        ...message,
        createdAt: new Date().toISOString(),
      });
      return true;
    }
    if (!mailReady()) return false;
    await smtp().sendMail({ from: env.MAIL_FROM, ...message });
    return true;
  } catch (error) {
    console.error("mail not sent:", (error as Error).message);
    return false;
  }
}
