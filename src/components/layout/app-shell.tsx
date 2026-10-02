"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { findNavItem } from "@/config/nav";
import { AppSidebar } from "./app-sidebar";
import { BottomNav } from "./bottom-nav";
import { LanguageSwitch } from "./language-switch";
import { OnlineBanner } from "./online-banner";
import { SyncBadge } from "./sync-badge";
import { UserMenu } from "./user-menu";

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const current = findNavItem(pathname);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 md:px-4">
          <SidebarTrigger className="max-md:hidden" />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold md:text-lg">
            {current ? t(current.key) : null}
          </h1>
          <SyncBadge />
          <LanguageSwitch />
          <UserMenu />
        </header>
        <main className="flex-1 p-3 pb-24 md:p-6 md:pb-6">
          <OnlineBanner />
          {children}
        </main>
        <BottomNav />
      </SidebarInset>
    </SidebarProvider>
  );
}
