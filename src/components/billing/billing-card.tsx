"use client";

import { CreditCard } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { useBillingStatus } from "@/billing/client";
import { Button } from "@/components/ui/button";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { STATE_TONE, useBillingSummary } from "./billing-summary";

/**
 * The shop's plan and the time left, at the bottom of the sidebar, with a way to renew. For the
 * people who can pay (owner and manager), and only for a shop that has billing.
 */
export function BillingCard() {
  const t = useTranslations("billing");
  const { role } = useProfile();
  const status = useBillingStatus();
  const { planName, stateLabel, timeLeft } = useBillingSummary(status);
  const { setOpenMobile } = useSidebar();
  if (status.mode === "off" || !can(role, "billing.manage")) return null;

  const title = planName ?? t("title");
  const needsAction = ["ending", "overdue", "locked"].includes(status.state);
  return (
    <>
      {/* Collapsed to icons: one button. */}
      <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
        <SidebarMenuButton asChild tooltip={`${title} · ${stateLabel}`}>
          <Link href="/billing" onClick={() => setOpenMobile(false)}>
            <CreditCard aria-hidden />
            <span>{title}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <li
        className="mb-1 rounded-lg border bg-sidebar-accent/40 p-2.5 text-xs group-data-[collapsible=icon]:hidden"
        data-testid="billing-card"
      >
        <div className="flex items-center gap-2">
          <CreditCard className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {title}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
              STATE_TONE[status.state],
            )}
            data-testid="billing-card-state"
          >
            {stateLabel}
          </span>
        </div>
        {timeLeft ? (
          <p
            className="mt-1 text-muted-foreground"
            data-testid="billing-card-left"
          >
            {timeLeft}
          </p>
        ) : null}
        {status.mode === "paid" ? (
          <Button
            asChild
            size="sm"
            variant={needsAction ? "default" : "outline"}
            className="mt-2 h-7 w-full"
          >
            <Link href="/billing" onClick={() => setOpenMobile(false)}>
              {t("renew")}
            </Link>
          </Button>
        ) : null}
      </li>
    </>
  );
}
