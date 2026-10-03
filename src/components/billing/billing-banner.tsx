"use client";

import { AlertTriangle, Clock } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { useBillingStatus } from "@/billing/client";
import { useBillingSummary } from "./billing-summary";

/**
 * A reminder above every screen: the period ends soon (owner and manager), payment is due and the
 * app will lock on a date (everyone), or a payment is being checked (everyone).
 */
export function BillingBanner() {
  const t = useTranslations("billing");
  const { role } = useProfile();
  const pathname = usePathname();
  const status = useBillingStatus();
  const { date } = useBillingSummary(status);
  const canPay = can(role, "billing.manage");
  if (pathname === "/billing" || status.mode !== "paid") return null;

  let text: string | null = null;
  let urgent = false;
  if (status.provisional)
    text = t("banner.provisional", { date: date(status.provisionalUntil) });
  else if (status.state === "overdue") {
    text = t("banner.overdue", { date: date(status.lockAt) });
    urgent = true;
  } else if (status.state === "ending" && canPay)
    text = t(status.trial ? "banner.trialEnding" : "banner.ending", {
      date: date(status.paidUntil),
    });
  if (!text) return null;

  const Icon = urgent ? AlertTriangle : Clock;
  return (
    <div
      role="status"
      className={
        urgent
          ? "mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm"
          : "mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
      }
      data-testid="billing-banner"
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 font-medium">{text}</span>
      {canPay && !status.provisional ? (
        <Link href="/billing" className="text-sm font-medium text-primary">
          {t("renew")}
        </Link>
      ) : null}
    </div>
  );
}
