"use client";

import { ArrowUp } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { type SyncIndicator, useSyncStatus } from "@/sync/use-sync-status";

export const DOT: Record<SyncIndicator, string> = {
  issue: "bg-destructive",
  offline: "bg-amber-500",
  syncing: "bg-sky-500 animate-pulse",
  pending: "bg-amber-500",
  synced: "bg-emerald-500",
};

/** The small global status chip (spec §31). Never blocks the screen: offline is normal. */
export function SyncBadge() {
  const t = useTranslations("status");
  const f = useFormat();
  const { indicator, pending } = useSyncStatus();

  const label =
    indicator === "pending"
      ? t("pending", { count: pending, n: f.integer(pending) })
      : t(indicator);
  const showCount = pending > 0 && indicator !== "pending";

  return (
    <Link href="/sync" aria-label={label}>
      <Badge
        variant="outline"
        className="h-7 gap-1.5 px-2.5"
        data-indicator={indicator}
      >
        <span
          aria-hidden
          className={cn("size-2 shrink-0 rounded-full", DOT[indicator])}
        />
        {indicator === "pending" ? (
          <>
            <span className="inline-flex items-center sm:hidden">
              <ArrowUp className="size-3" aria-hidden />
              {f.integer(pending)}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </>
        ) : (
          <span>{label}</span>
        )}
        {showCount ? (
          <span className="inline-flex items-center text-muted-foreground">
            <ArrowUp className="size-3" aria-hidden />
            {f.integer(pending)}
          </span>
        ) : null}
      </Badge>
    </Link>
  );
}
