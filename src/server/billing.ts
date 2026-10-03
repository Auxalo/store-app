import { randomUUID } from "node:crypto";
import type { ClientSession, Db, MongoClient } from "mongodb";
import {
  DEFAULT_PLATFORM_BILLING,
  type PlatformBilling,
  plansFor,
} from "@/billing/plans";
import {
  type BillingDoc,
  type BillingMode,
  billingStateOf,
  endOfDayPlus,
  endOfDhakaDay,
  marksFor,
  nextPeriod,
  normalizeTrxId,
  stampOf,
} from "@/billing/state";
import type { SubmitPaymentInput } from "@/schemas/billing";
import { type AdminActor, logAdminAction } from "./admin-shops";
import { clearStoreCaches, TtlCache } from "./cache";
import { HttpError } from "./http";
import { shopGate } from "./shop-status";

/**
 * Subscriptions, paid by bKash or Nagad "Send Money" and checked by hand by the operator.
 *
 * The shop's billing lives on its own record (`stores.billing`), which only the operator changes
 * (never in the shop's settings, which the shop can write). Payments are kept in `billingPayments`;
 * a shop sees its own, the operator sees all. Every change the operator makes is logged.
 */

export type PaymentMethod = "bkash" | "nagad" | "cash" | "other";
export type PaymentStatus = "pending" | "approved" | "rejected";

export interface PaymentDoc {
  _id: string;
  storeId: string;
  amount: number;
  method: PaymentMethod;
  trxId: string;
  /** The id as compared (unique across all shops); removed when the payment is rejected. */
  trxKey?: string;
  sender: string;
  planId: string | null;
  months: number;
  status: PaymentStatus;
  submittedAt: Date;
  submittedBy: { id: string; name: string } | null;
  reviewedAt?: Date | null;
  reviewedBy?: { id: string; name: string } | null;
  reason?: string;
  note?: string;
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

export interface Deps {
  db: Db;
  client: MongoClient;
}

type StoreDoc = {
  _id: string;
  name?: string;
  billing?: BillingDoc;
};

const SETTINGS_ID = "billing";
const MAX_PENDING = 3;
const settingsCache = new TtlCache<PlatformBilling>(60_000, 1);

const stores = (db: Db) => db.collection<StoreDoc>("stores");
const payments = (db: Db) => db.collection<PaymentDoc>("billingPayments");

/** The operator's billing settings (their saved values over the defaults). Cached for a minute. */
export async function getPlatformBilling(db: Db): Promise<PlatformBilling> {
  return (await settingsCache.load(SETTINGS_ID, async () => {
    const saved = await db
      .collection<{ _id: string } & Partial<PlatformBilling>>(
        "platformSettings",
      )
      .findOne({ _id: SETTINGS_ID });
    const { _id, ...rest } = saved ?? { _id: SETTINGS_ID };
    return { ...DEFAULT_PLATFORM_BILLING, ...rest };
  })) as PlatformBilling;
}

export function forgetPlatformBilling(): void {
  settingsCache.clear();
}

/** The warning and lock dates for this billing under these settings. */
function withMarks(billing: BillingDoc, settings: PlatformBilling): BillingDoc {
  return {
    ...billing,
    ...marksFor(
      billing.paidUntil ?? null,
      billing.graceDays ?? settings.graceDays,
      settings.reminderDays,
    ),
  };
}

/** How a new shop starts: the operator's default, or what they chose when creating it. */
export function initialBilling(
  settings: PlatformBilling,
  now: Date,
  choice: { mode?: BillingMode; trialDays?: number; paidUntil?: Date } = {},
): BillingDoc {
  const mode = choice.mode ?? settings.newShop.mode;
  if (mode !== "paid") return { mode };
  const paidUntil =
    choice.paidUntil ??
    endOfDayPlus(now, choice.trialDays ?? settings.newShop.trialDays);
  const firstPlan = settings.plans.find((p) => p.active) ?? settings.plans[0];
  return withMarks(
    {
      mode,
      planId: firstPlan?.id ?? null,
      price: null,
      paidUntil,
      paidOnce: false,
      graceDays: null,
      anchorDay: null,
    },
    settings,
  );
}

/** Writes the billing fields one by one (the shop record is also updated by every sale). */
function billingSet(billing: BillingDoc): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(billing))
    if (value !== undefined) set[`billing.${key}`] = value;
  return set;
}

const nameOf = (store: StoreDoc | null) => String(store?.name ?? "");
const taka = (poisha: number) =>
  `৳${(poisha / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function samePeriod(a?: Date | null, b?: Date | null): boolean {
  return (a?.getTime() ?? 0) === (b?.getTime() ?? 0);
}

// ---------------------------------------------------------------------------------------------
// What the shop sees and does
// ---------------------------------------------------------------------------------------------

export interface PaymentView {
  id: string;
  amount: number;
  method: PaymentMethod;
  trxId: string;
  sender: string;
  months: number;
  status: PaymentStatus;
  reason: string;
  submittedAt: string;
  reviewedAt: string | null;
  periodEnd: string | null;
}

const viewOf = (p: PaymentDoc): PaymentView => ({
  id: p._id,
  amount: p.amount,
  method: p.method,
  trxId: p.trxId,
  sender: p.sender,
  months: p.months,
  status: p.status,
  reason: p.reason ?? "",
  submittedAt: p.submittedAt.toISOString(),
  reviewedAt: p.reviewedAt?.toISOString() ?? null,
  periodEnd: p.periodEnd?.toISOString() ?? null,
});

/** Everything the shop's billing page shows. `full` is false for people who cannot pay (a cashier). */
export async function shopBillingView(
  db: Db,
  storeId: string,
  full: boolean,
  now = new Date(),
) {
  const { billing } = await shopGate(db, storeId);
  const stamp = stampOf(billing, now);
  if (!full) return { billing: stamp };
  const [settings, rows] = await Promise.all([
    getPlatformBilling(db),
    payments(db)
      .find({ storeId })
      .sort({ submittedAt: -1 })
      .limit(20)
      .toArray(),
  ]);
  const status = billingStateOf(billing, now);
  return {
    billing: stamp,
    planId: billing?.planId ?? null,
    plans: plansFor(settings, billing ?? {}),
    payTo: settings.payTo,
    provisionalHours: settings.provisionalHours,
    /** A locked shop sending a payment now would be let in while it is checked. */
    canOpenNow:
      status.locked &&
      settings.provisionalHours > 0 &&
      !samePeriod(billing?.provisionalFor, billing?.paidUntil ?? new Date(0)),
    payments: rows.map(viewOf),
  };
}

/**
 * The shop says it sent money. The payment waits for the operator. A locked shop is let in for
 * `provisionalHours` (once per period) so it can keep selling while the operator checks.
 */
export async function submitPayment(
  db: Db,
  storeId: string,
  by: { id: string; name: string },
  input: SubmitPaymentInput,
  now = new Date(),
): Promise<{ payment: PaymentView; opened: boolean }> {
  const [{ billing }, settings] = await Promise.all([
    shopGate(db, storeId),
    getPlatformBilling(db),
  ]);
  if (billing?.mode !== "paid") throw new HttpError(409, "BILLING_NOT_PAID");
  const plan = plansFor(settings, billing).find((p) => p.id === input.planId);
  if (!plan) throw new HttpError(400, "INVALID_PLAN");
  const pending = await payments(db).countDocuments({
    storeId,
    status: "pending",
  });
  if (pending >= MAX_PENDING) throw new HttpError(429, "TOO_MANY_PENDING");

  const payment: PaymentDoc = {
    _id: randomUUID(),
    storeId,
    amount: input.amount,
    method: input.method,
    trxId: input.trxId,
    trxKey: normalizeTrxId(input.trxId),
    sender: input.sender,
    planId: plan.id,
    months: plan.months,
    status: "pending",
    submittedAt: now,
    submittedBy: by,
  };
  try {
    await payments(db).insertOne(payment);
  } catch (error) {
    // The same transaction id was already sent (by this shop or another): never counted twice.
    if ((error as { code?: number }).code === 11000)
      throw new HttpError(409, "TRX_USED");
    throw error;
  }

  const status = billingStateOf(billing, now);
  const periodKey = billing.paidUntil ?? new Date(0);
  const opened =
    status.locked &&
    settings.provisionalHours > 0 &&
    !samePeriod(billing.provisionalFor, periodKey);
  if (opened) {
    await stores(db).updateOne(
      { _id: storeId },
      {
        $set: {
          "billing.provisionalUntil": new Date(
            now.getTime() + settings.provisionalHours * 3_600_000,
          ),
          "billing.provisionalFor": periodKey,
        },
      },
    );
    clearStoreCaches();
  }
  return { payment: viewOf(payment), opened };
}

// ---------------------------------------------------------------------------------------------
// What the operator does
// ---------------------------------------------------------------------------------------------

/** Moves a shop's period on by `months` (a payment), inside the caller's transaction. */
async function extendByPayment(
  db: Db,
  session: ClientSession | undefined,
  store: StoreDoc,
  settings: PlatformBilling,
  months: number,
  planId: string | null,
  now: Date,
): Promise<{ start: Date; paidUntil: Date }> {
  const current = store.billing ?? { mode: "off" as const };
  const next = nextPeriod(current, months, now);
  const billing = withMarks(
    {
      ...current,
      // A shop without billing that pays is now a paying shop; a free shop stays free.
      mode: current.mode === "free" ? "free" : "paid",
      paidUntil: next.paidUntil,
      anchorDay: next.anchorDay,
      paidOnce: true,
      provisionalUntil: null,
      // An agreed price stays with its plan; otherwise the shop is now on the plan it paid for.
      planId:
        typeof current.price === "number"
          ? (current.planId ?? planId)
          : (planId ?? current.planId ?? null),
    },
    settings,
  );
  await stores(db).updateOne(
    { _id: store._id },
    { $set: billingSet(billing) },
    { session },
  );
  return { start: next.start, paidUntil: next.paidUntil };
}

/** Approves a payment a shop sent: its period moves on, and a locked shop opens. */
export async function approvePayment(
  { db, client }: Deps,
  admin: AdminActor,
  paymentId: string,
  change: { amount?: number; months?: number } = {},
  now = new Date(),
): Promise<PaymentView> {
  const settings = await getPlatformBilling(db);
  const session = client.startSession();
  let result: { payment: PaymentDoc; store: StoreDoc } | undefined;
  try {
    await session.withTransaction(async () => {
      const payment = await payments(db).findOne(
        { _id: paymentId },
        { session },
      );
      if (!payment) throw new HttpError(404, "NOT_FOUND");
      if (payment.status !== "pending")
        throw new HttpError(409, "ALREADY_REVIEWED");
      const store = await stores(db).findOne(
        { _id: payment.storeId },
        { session },
      );
      if (!store) throw new HttpError(404, "NOT_FOUND");
      const months = change.months ?? payment.months;
      const period = await extendByPayment(
        db,
        session,
        store,
        settings,
        months,
        payment.planId,
        now,
      );
      const update = {
        status: "approved" as const,
        amount: change.amount ?? payment.amount,
        months,
        reviewedAt: now,
        reviewedBy: { id: admin.id, name: admin.name },
        periodStart: period.start,
        periodEnd: period.paidUntil,
      };
      await payments(db).updateOne(
        { _id: paymentId, status: "pending" },
        { $set: update },
        { session },
      );
      result = { payment: { ...payment, ...update }, store };
    });
  } finally {
    await session.endSession();
  }
  if (!result) throw new HttpError(500, "INTERNAL");
  clearStoreCaches();
  const { payment, store } = result;
  await logAdminAction(
    db,
    admin,
    "billing.approve",
    payment.storeId,
    `${nameOf(store)}: ${taka(payment.amount)}, ${payment.months} month(s), ${payment.method} ${payment.trxId}`,
  );
  return viewOf(payment);
}

/** Refuses a payment (wrong id, wrong amount...). The shop sees the reason; the id can be sent again. */
export async function rejectPayment(
  db: Db,
  admin: AdminActor,
  paymentId: string,
  reason: string,
  now = new Date(),
): Promise<PaymentView> {
  const payment = await payments(db).findOneAndUpdate(
    { _id: paymentId, status: "pending" },
    {
      $set: {
        status: "rejected",
        reason,
        reviewedAt: now,
        reviewedBy: { id: admin.id, name: admin.name },
      },
      $unset: { trxKey: "" },
    },
    { returnDocument: "after" },
  );
  if (!payment) {
    const exists = await payments(db).countDocuments({ _id: paymentId });
    throw new HttpError(
      exists ? 409 : 404,
      exists ? "ALREADY_REVIEWED" : "NOT_FOUND",
    );
  }
  // The shop was let in only while this was being checked.
  await stores(db).updateOne(
    { _id: payment.storeId },
    { $set: { "billing.provisionalUntil": null } },
  );
  clearStoreCaches();
  const store = await stores(db).findOne(
    { _id: payment.storeId },
    { projection: { name: 1 } },
  );
  await logAdminAction(
    db,
    admin,
    "billing.reject",
    payment.storeId,
    `${nameOf(store)}: ${payment.method} ${payment.trxId} — ${reason}`,
  );
  return viewOf(payment);
}

/** A payment the operator took themselves (cash, or one that came in another way). */
export async function recordManualPayment(
  { db, client }: Deps,
  admin: AdminActor,
  storeId: string,
  input: {
    amount: number;
    method: PaymentMethod;
    trxId: string;
    months: number;
    planId?: string;
    note: string;
  },
  now = new Date(),
): Promise<PaymentView> {
  const settings = await getPlatformBilling(db);
  const session = client.startSession();
  let payment: PaymentDoc | undefined;
  let storeName = "";
  try {
    await session.withTransaction(async () => {
      const store = await stores(db).findOne({ _id: storeId }, { session });
      if (!store) throw new HttpError(404, "NOT_FOUND");
      storeName = nameOf(store);
      const period = await extendByPayment(
        db,
        session,
        store,
        settings,
        input.months,
        input.planId ?? null,
        now,
      );
      const trxId = input.trxId.trim();
      payment = {
        _id: randomUUID(),
        storeId,
        amount: input.amount,
        method: input.method,
        trxId,
        ...(trxId ? { trxKey: normalizeTrxId(trxId) } : {}),
        sender: "",
        planId: input.planId ?? store.billing?.planId ?? null,
        months: input.months,
        status: "approved",
        submittedAt: now,
        submittedBy: null,
        reviewedAt: now,
        reviewedBy: { id: admin.id, name: admin.name },
        note: input.note,
        periodStart: period.start,
        periodEnd: period.paidUntil,
      };
      await payments(db).insertOne(payment, { session });
    });
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new HttpError(409, "TRX_USED");
    throw error;
  } finally {
    await session.endSession();
  }
  if (!payment) throw new HttpError(500, "INTERNAL");
  clearStoreCaches();
  await logAdminAction(
    db,
    admin,
    "billing.record",
    storeId,
    `${storeName}: ${taka(input.amount)}, ${input.months} month(s), ${input.method}${input.trxId ? ` ${input.trxId}` : ""}${input.note ? ` — ${input.note}` : ""}`,
  );
  return viewOf(payment);
}

/** The operator changes a shop's billing directly. Only what is given changes. */
export async function setShopBilling(
  db: Db,
  admin: AdminActor,
  storeId: string,
  patch: {
    mode?: BillingMode;
    planId?: string | null;
    price?: number | null;
    graceDays?: number | null;
    paidUntil?: string | null;
  },
  now = new Date(),
): Promise<BillingDoc | null> {
  const [store, settings] = await Promise.all([
    stores(db).findOne({ _id: storeId }),
    getPlatformBilling(db),
  ]);
  if (!store) return null;
  const current: BillingDoc = store.billing ?? { mode: "off" };
  const next: BillingDoc = { ...current };
  const changes: string[] = [];

  if (patch.mode !== undefined && patch.mode !== current.mode) {
    next.mode = patch.mode;
    changes.push(`mode ${current.mode} → ${patch.mode}`);
    // Turning billing on for a shop with no period yet gives it the trial before it must pay.
    if (
      patch.mode === "paid" &&
      !current.paidUntil &&
      patch.paidUntil === undefined
    ) {
      next.paidUntil = endOfDayPlus(now, settings.newShop.trialDays);
      next.paidOnce = current.paidOnce ?? false;
      changes.push(`trial until ${next.paidUntil.toISOString().slice(0, 10)}`);
    }
  }
  if (patch.planId !== undefined && patch.planId !== (current.planId ?? null)) {
    if (patch.planId && !settings.plans.some((p) => p.id === patch.planId))
      throw new HttpError(400, "INVALID_PLAN");
    next.planId = patch.planId;
    changes.push(`plan ${patch.planId ?? "none"}`);
  }
  if (patch.price !== undefined && patch.price !== (current.price ?? null)) {
    next.price = patch.price;
    changes.push(
      patch.price === null ? "plan price" : `price ${taka(patch.price)}`,
    );
  }
  if (
    patch.graceDays !== undefined &&
    patch.graceDays !== (current.graceDays ?? null)
  ) {
    next.graceDays = patch.graceDays;
    changes.push(
      patch.graceDays === null
        ? "default grace"
        : `grace ${patch.graceDays} day(s)`,
    );
  }
  if (patch.paidUntil !== undefined) {
    if (patch.paidUntil === null) {
      next.paidUntil = null;
      changes.push("no end date");
    } else {
      const [y, m, d] = patch.paidUntil.split("-").map(Number);
      next.paidUntil = endOfDhakaDay(y, m - 1, d);
      next.anchorDay = d;
      changes.push(`ends ${patch.paidUntil}`);
    }
    next.provisionalUntil = null;
  }
  if (changes.length === 0) return current;

  const billing = withMarks(next, settings);
  await stores(db).updateOne(
    { _id: storeId },
    { $set: { ...billingSet(billing), updatedAt: now } },
  );
  clearStoreCaches();
  await logAdminAction(
    db,
    admin,
    "billing.update",
    storeId,
    `${nameOf(store)}: ${changes.join(", ")}`,
  );
  return billing;
}

/** Gives a paying shop extra days for free (a gift, a fault on our side...). */
export async function extendShop(
  db: Db,
  admin: AdminActor,
  storeId: string,
  days: number,
  reason: string,
  now = new Date(),
): Promise<BillingDoc | null> {
  const [store, settings] = await Promise.all([
    stores(db).findOne({ _id: storeId }),
    getPlatformBilling(db),
  ]);
  if (!store) return null;
  const current = store.billing;
  if (current?.mode !== "paid") throw new HttpError(409, "BILLING_NOT_PAID");
  // A locked shop gets the days from today; otherwise they are added to the end of its period.
  const locked = billingStateOf(current, now).locked;
  const from = !locked && current.paidUntil ? current.paidUntil : now;
  const billing = withMarks(
    { ...current, paidUntil: endOfDayPlus(from, days), provisionalUntil: null },
    settings,
  );
  await stores(db).updateOne(
    { _id: storeId },
    { $set: { ...billingSet(billing), updatedAt: now } },
  );
  clearStoreCaches();
  await logAdminAction(
    db,
    admin,
    "billing.extend",
    storeId,
    `${nameOf(store)}: +${days} day(s)${reason ? ` — ${reason}` : ""}`,
  );
  return billing;
}

/** Saves the operator's billing settings. New grace or reminder days apply to every paying shop. */
export async function savePlatformBilling(
  db: Db,
  admin: AdminActor,
  next: PlatformBilling,
): Promise<PlatformBilling> {
  const before = await getPlatformBilling(db);
  await db
    .collection<{ _id: string }>("platformSettings")
    .updateOne({ _id: SETTINGS_ID }, { $set: next }, { upsert: true });
  forgetPlatformBilling();
  if (
    before.graceDays !== next.graceDays ||
    before.reminderDays !== next.reminderDays
  )
    await recomputeMarks(db, next);
  clearStoreCaches();
  await logAdminAction(
    db,
    admin,
    "settings.billing",
    null,
    `${next.plans.length} plan(s), grace ${next.graceDays}, reminder ${next.reminderDays}, trial ${next.newShop.trialDays}`,
  );
  return next;
}

/** Works out the warning and lock dates of every paying shop again (after the settings change). */
export async function recomputeMarks(
  db: Db,
  settings: PlatformBilling,
): Promise<number> {
  const rows = await stores(db)
    .find({ "billing.mode": "paid" })
    .project<StoreDoc>({ billing: 1 })
    .toArray();
  if (rows.length === 0) return 0;
  await stores(db).bulkWrite(
    rows.map((row) => {
      const billing = withMarks(row.billing as BillingDoc, settings);
      return {
        updateOne: {
          filter: { _id: row._id },
          update: {
            $set: {
              "billing.warnFrom": billing.warnFrom ?? null,
              "billing.lockAt": billing.lockAt ?? null,
            },
          },
        },
      };
    }),
  );
  return rows.length;
}
