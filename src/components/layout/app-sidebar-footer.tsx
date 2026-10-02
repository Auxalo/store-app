"use client";

import { Globe, Info, MessageCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
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

/** Bottom of the sidebar: where this device stands with syncing, and who built the app. */
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
      <div
        className="flex flex-col gap-1 px-2 pb-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
        data-testid="developer-info"
      >
        <p>
          {t("developer.label")}:{" "}
          <span className="font-medium text-foreground">{DEVELOPER.name}</span>
        </p>
        <a
          href={DEVELOPER.siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline"
        >
          <Globe className="size-3.5" aria-hidden />
          {DEVELOPER.site}
        </a>
        <a
          href={DEVELOPER.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline"
          aria-label={`${t("developer.whatsapp")} ${DEVELOPER.whatsapp}`}
        >
          <MessageCircle className="size-3.5" aria-hidden />
          {t("developer.whatsapp")}: {DEVELOPER.whatsapp}
        </a>
      </div>
    </SidebarFooter>
  );
}
