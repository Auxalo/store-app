import "server-only";
import { getAuth } from "@/auth/server";
import type { BillingMode } from "@/billing/state";
import { getDb } from "@/db/server/mongo";
import { DEFAULT_CURRENCY, DEFAULT_TIME_ZONE } from "@/lib/constants";
import { serverEnv } from "@/lib/env";
import { newId } from "@/lib/ids";
import type { OwnerSignupInput } from "@/schemas/auth";
import { getPlatformBilling, initialBilling } from "./billing-settings";
import { sendMail } from "./mail";
import { welcomeMail } from "./mail-templates";

export class UsernameTakenError extends Error {
  constructor() {
    super("USERNAME_TAKEN");
  }
}

export class EmailTakenError extends Error {
  constructor() {
    super("EMAIL_TAKEN");
  }
}

/** Synthetic address: Better Auth requires an email, but shop staff log in by username/phone. */
export function syntheticEmail(username: string) {
  return `${username}@users.store-app.invalid`;
}

/** How the operator wants a new shop's billing to start (otherwise their default applies). */
export interface BillingStart {
  mode?: BillingMode;
  trialDays?: number;
  paidUntil?: Date;
}

/**
 * Creates a store and its owner. Used by public signup, the operator panel and `pnpm shop:create`;
 * staff accounts reuse `createStoreUser`. Rolls the store back if the user cannot be created.
 */
export async function createStoreWithOwner(
  input: OwnerSignupInput,
  billingStart: BillingStart = {},
) {
  const db = await getDb();
  const username = input.username.toLowerCase();

  const storeId = newId();
  const now = new Date();
  const billing = initialBilling(
    await getPlatformBilling(db),
    now,
    billingStart,
  );
  await db.collection<{ _id: string }>("stores").insertOne({
    _id: storeId,
    name: input.storeName,
    currency: DEFAULT_CURRENCY,
    timeZone: DEFAULT_TIME_ZONE,
    syncSeq: 0,
    billing,
    createdAt: now,
    updatedAt: now,
  } as never);

  try {
    const user = await createStoreUser({
      storeId,
      username,
      displayName: input.ownerName,
      password: input.password,
      role: "owner",
      email: input.email,
    });
    // A welcome mail with the username (never the password), best effort.
    if (input.email) {
      const base = serverEnv().BETTER_AUTH_URL ?? "";
      const mail = welcomeMail(
        input.ownerName,
        input.storeName,
        username,
        base ? `${base.replace(/\/$/, "")}/login` : "",
      );
      await sendMail({ to: input.email, ...mail });
    }
    return { storeId, userId: user.id };
  } catch (error) {
    await db.collection("stores").deleteOne({ _id: storeId } as never);
    throw error;
  }
}

export async function createStoreUser(params: {
  storeId: string;
  username: string;
  displayName: string;
  password: string;
  role: "owner" | "manager" | "cashier";
  /** A real address (the owner's, for "forgot password"); staff have none and get a made-up one. */
  email?: string;
}) {
  const auth = await getAuth();
  const ctx = await auth.$context;
  const username = params.username.toLowerCase();

  const existing = await ctx.adapter.findOne({
    model: "user",
    where: [{ field: "username", value: username }],
  });
  if (existing) throw new UsernameTakenError();
  const email = params.email?.trim().toLowerCase();
  if (email) {
    const taken = await ctx.adapter.findOne({
      model: "user",
      where: [{ field: "email", value: email }],
    });
    if (taken) throw new EmailTakenError();
  }

  let user: Awaited<ReturnType<typeof ctx.internalAdapter.createUser>>;
  try {
    user = await ctx.internalAdapter.createUser(
      {
        email: email ?? syntheticEmail(username),
        emailVerified: true,
        name: params.displayName,
        username,
        displayUsername: params.username,
        storeId: params.storeId,
        role: params.role,
        isActive: true,
      },
      { method: "admin" },
    );
  } catch (error) {
    // Unique index race (two signups with the same username or email at once).
    if ((error as { code?: number })?.code === 11000)
      throw (error as { keyPattern?: Record<string, unknown> }).keyPattern
        ?.email
        ? new EmailTakenError()
        : new UsernameTakenError();
    throw error;
  }

  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(params.password),
  });
  // A new person: devices re-read the shop's people list (see bumpStaffVersion).
  try {
    const { bumpStaffVersion } = await import("./staff");
    await bumpStaffVersion(await getDb(), params.storeId);
  } catch {
    /* the list is also re-read on every page load */
  }
  return user;
}
