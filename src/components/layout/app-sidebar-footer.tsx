"use client";

import { Info, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BillingCard } from "@/components/billing/billing-card";
import { DeveloperLinks } from "@/components/shared/developer-links";
import { WorkOfflineSwitch } from "@/components/sync/work-offline";
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { DEVELOPER } from "@/config/developer";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { useSyncStatus } from "@/sync/use-sync-status";
import { DOT } from "./sync-badge";

/** Bottom of the sidebar: the shop's plan, where this device stands with syncing, who built the app. */
export function AppSidebarFooter() {
  const t = useTranslations();
  const f = useFormat();
  const { setOpenMobile } = useSidebar();
  const { indicator, pending } = useSyncStatus();
  const syncLabel =
    indicator === "pending"
      ? t("status.pending", { count: pending, n: f.integer(pending) })
      : t(`status.${indicator}`);

  return (
    <SidebarFooter>
      <SidebarMenu>
        <BillingCard />
        <WorkOfflineSwitch variant="sidebar" />
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip={syncLabel}>
            <Link
              href="/sync"
              onClick={() => setOpenMobile(false)}
              data-testid="sidebar-sync"
            >
              <span className="relative">
                <RefreshCw aria-hidden />
                <span
                  aria-hidden
                  className={cn(
                    "absolute -end-0.5 -top-0.5 size-2 rounded-full ring-2 ring-sidebar",
                    DOT[indicator],
                  )}
                />
              </span>
              <span className="truncate">{syncLabel}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>

        {/* Collapsed to icons: a single info button with the developer's name. */}
        <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
          <SidebarMenuButton
            asChild
            tooltip={`${t("developer.label")}: ${DEVELOPER.name}`}
          >
            <a
              href={DEVELOPER.siteUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Info aria-hidden />
              <span>{DEVELOPER.name}</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>

      <SidebarSeparator className="mx-0 group-data-[collapsible=icon]:hidden" />
      <DeveloperLinks className="px-2 pb-1 group-data-[collapsible=icon]:hidden" />
    </SidebarFooter>
  );
}
