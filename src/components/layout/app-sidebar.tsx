"use client";

import { Lock, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useProfile } from "@/auth/use-auth";
import { useBillingStatus, useBillingStore } from "@/billing/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { navGroups, navItemsFor } from "@/config/nav";
import { AppSidebarFooter } from "./app-sidebar-footer";

/** Desktop sidebar; on phones it opens as a sheet from the bottom bar's "More" button. */
export function AppSidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const profile = useProfile();
  const { setOpenMobile } = useSidebar();
  // Billing shows only for a shop that has it; while locked, every other entry leads to it.
  const billingMode = useBillingStore((s) => s.stamp?.mode ?? "off");
  const { locked } = useBillingStatus();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              tooltip={profile.storeName ?? t("app.name")}
            >
              <Link href="/dashboard" onClick={() => setOpenMobile(false)}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Store className="size-4" aria-hidden />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">
                    {profile.storeName ?? t("app.name")}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t("app.name")}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel>{t(`navGroups.${group}`)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItemsFor(profile.role)
                  .filter((item) => item.group === group)
                  .filter(
                    (item) => item.key !== "billing" || billingMode !== "off",
                  )
                  .map((item) => (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        asChild
                        isActive={
                          pathname === item.href ||
                          pathname.startsWith(`${item.href}/`)
                        }
                        tooltip={t(`nav.${item.key}`)}
                      >
                        <Link
                          href={item.href}
                          onClick={() => setOpenMobile(false)}
                        >
                          <item.icon aria-hidden />
                          <span>{t(`nav.${item.key}`)}</span>
                          {locked && item.key !== "billing" ? (
                            <Lock
                              className="ms-auto size-3.5 opacity-60"
                              aria-hidden
                            />
                          ) : null}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <AppSidebarFooter />
      <SidebarRail />
    </Sidebar>
  );
}
