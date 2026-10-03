import type { Db } from "mongodb";
import {
  DEFAULT_PLATFORM_BILLING,
  type PlatformBilling,
} from "@/billing/plans";
import {
  type BillingDoc,
  type BillingMode,
  type BillingStamp,
  endOfDayPlus,
  marksFor,
  stampOf,
} from "@/billing/state";
import { TtlCache } from "./cache";

export const SETTINGS_ID = "billing";
const settingsCache = new TtlCache<PlatformBilling>(60_000, 1);

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

/** What a device is told about the shop's billing, with its plan's name. */
export async function stampWithPlan(
  db: Db,
  billing: BillingDoc | null | undefined,
  now = new Date(),
): Promise<BillingStamp> {
  if (!billing?.planId || billing.mode === "off") return stampOf(billing, now);
  const settings = await getPlatformBilling(db);
  const plan = settings.plans.find((p) => p.id === billing.planId);
  return stampOf(
    billing,
    now,
    plan ? { name: plan.name, nameBn: plan.nameBn } : null,
  );
}

/** The warning and lock dates for this billing under these settings. */
export function withMarks(
  billing: BillingDoc,
  settings: PlatformBilling,
): BillingDoc {
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
