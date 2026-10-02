"use client";

import { WifiOff } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { useDataMode } from "@/data/mode-store";
import { useConnectivity } from "@/stores/connectivity";

/**
 * Online mode with no internet: saving is paused (nothing is lost; a sale in progress stays in
 * the cart) and the banner says so. Reading what is already on screen keeps working.
 */
export function OnlineBanner() {
  const t = useTranslations("mode.banner");
  const mode = useDataMode();
  const online = useConnectivity((s) => s.online);
  const { role } = useProfile();
  if (mode !== "online" || online) return null;
  return (
    <div
      role="alert"
      className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
      data-testid="online-banner"
    >
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{t("text")}</span>
        <span className="block text-xs text-muted-foreground">{t("hint")}</span>
      </span>
      {can(role, "mode.switch") ? (
        <Link href="/sync" className="text-sm font-medium text-primary">
          {t("action")}
        </Link>
      ) : null}
    </div>
  );
}
