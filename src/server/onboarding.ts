import "server-only";
import { getAuth } from "@/auth/server";
import type { BillingMode } from "@/billing/state";
import { getDb } from "@/db/server/mongo";
import { DEFAULT_CURRENCY, DEFAULT_TIME_ZONE } from "@/lib/constants";
import { newId } from "@/lib/ids";
import type { OwnerSignupInput } from "@/schemas/auth";
import { getPlatformBilling, initialBilling } from "./billing";

export class UsernameTakenError extends Error {
  constructor() {
    super("USERNAME_TAKEN");
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
    });
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
}) {
  const auth = await getAuth();
  const ctx = await auth.$context;
  const username = params.username.toLowerCase();

  const existing = await ctx.adapter.findOne({
    model: "user",
    where: [{ field: "username", value: username }],
  });
  if (existing) throw new UsernameTakenError();

  let user: Awaited<ReturnType<typeof ctx.internalAdapter.createUser>>;
  try {
    user = await ctx.internalAdapter.createUser(
      {
        email: syntheticEmail(username),
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
    // Unique index race (two signups with the same username at once).
    if ((error as { code?: number })?.code === 11000)
      throw new UsernameTakenError();
    throw error;
  }

  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await ctx.password.hash(params.password),
  });
  return user;
}
