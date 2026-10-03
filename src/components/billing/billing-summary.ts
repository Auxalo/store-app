"use client";

import { useLocale, useTranslations } from "next-intl";
import { useBillingStore } from "@/billing/client";
import type { BillingStatus } from "@/billing/state";
import { useFormat } from "@/i18n/use-format";

/** "Free trial", "12 days left", the plan's name: the short words the card, banner and page share. */
export function useBillingSummary(status: BillingStatus) {
  const t = useTranslations("billing");
  const f = useFormat();
  const locale = useLocale();
  const plan = useBillingStore((s) => s.stamp?.plan ?? null);

  const planName = plan ? (locale === "bn" ? plan.nameBn : plan.name) : null;
  const stateLabel = t(`state.${status.state}`);
  const date = (d: Date | null) => (d ? f.date(d) : "");

  let timeLeft: string | null = null;
  if (status.mode === "paid" && status.daysLeft !== null) {
    if (status.state === "locked") timeLeft = null;
    else if (status.daysLeft > 0)
      timeLeft = t("daysLeft", {
        count: status.daysLeft,
        n: f.integer(status.daysLeft),
      });
    else if (status.daysLeft === 0) timeLeft = t("endsToday");
    else timeLeft = t("locksOn", { date: date(status.lockAt) });
  }

  return { planName, stateLabel, timeLeft, date };
}

/** The badge colour for each state. */
export const STATE_TONE: Record<BillingStatus["state"], string> = {
  off: "bg-muted text-muted-foreground",
  free: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  trial: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  ending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  overdue: "bg-red-500/15 text-red-700 dark:text-red-400",
  locked: "bg-red-500/15 text-red-700 dark:text-red-400",
};
