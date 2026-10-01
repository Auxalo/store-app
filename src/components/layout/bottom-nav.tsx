"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSidebar } from "@/components/ui/sidebar";
import { navItems } from "@/config/nav";
import { cn } from "@/lib/utils";

const itemClass =
  "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium leading-tight transition-colors";

/** Phone navigation: four primary destinations plus "More" for everything else. */
export function BottomNav() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <nav
      aria-label={t("menu")}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {navItems
        .filter((item) => item.bottom)
        .map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                itemClass,
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-5" aria-hidden />
              <span className="max-w-full truncate">{t(item.key)}</span>
            </Link>
          );
        })}
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        className={cn(itemClass, "text-muted-foreground")}
      >
        <Menu className="size-5" aria-hidden />
        <span>{t("more")}</span>
      </button>
    </nav>
  );
}
