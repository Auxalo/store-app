import type { BillingMode } from "./state";

/** One plan the operator offers: pay `price` (poisha) for `months` months. */
export interface BillingPlan {
  id: string;
  name: string;
  nameBn: string;
  months: number;
  price: number;
  /** Hidden plans are kept (shops already on them) but no longer offered. */
  active: boolean;
}

export type PayMethod = "bkash" | "nagad";
export const PAY_METHODS: PayMethod[] = ["bkash", "nagad"];

/** The operator's billing settings (one record, `platformSettings` "billing"). */
export interface PlatformBilling {
  plans: BillingPlan[];
  /** The numbers shops send money to ("Send Money", a personal account). */
  payTo: Record<PayMethod, string>;
  /** How a newly created shop starts. */
  newShop: { mode: BillingMode; trialDays: number };
  /** Days after the end of a period before the app locks. */
  graceDays: number;
  /** Days before the end of a period when the shop starts being reminded. */
  reminderDays: number;
  /** Hours a locked shop is let in after sending a payment, while it is checked. */
  provisionalHours: number;
}

/** Until the operator saves their own, these apply. Prices are examples: set yours in the panel. */
export const DEFAULT_PLATFORM_BILLING: PlatformBilling = {
  plans: [
    {
      id: "m1",
      name: "1 month",
      nameBn: "১ মাস",
      months: 1,
      price: 500_00,
      active: true,
    },
    {
      id: "m6",
      name: "6 months",
      nameBn: "৬ মাস",
      months: 6,
      price: 2_700_00,
      active: true,
    },
    {
      id: "m12",
      name: "12 months",
      nameBn: "১২ মাস",
      months: 12,
      price: 5_000_00,
      active: true,
    },
  ],
  payTo: { bkash: "01772998823", nagad: "01772998823" },
  newShop: { mode: "paid", trialDays: 14 },
  graceDays: 3,
  reminderDays: 7,
  provisionalHours: 48,
};

/** The plans a shop may choose, at the price it pays (an agreed price fixes the shop's own plan). */
export function plansFor(
  settings: PlatformBilling,
  shop: { planId?: string | null; price?: number | null },
): BillingPlan[] {
  const own = settings.plans.find((p) => p.id === shop.planId);
  if (own && typeof shop.price === "number")
    return [{ ...own, price: shop.price }];
  return settings.plans.filter((p) => p.active);
}
