"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useConnectivity } from "@/stores/connectivity";

/** Small global status chip (spec §31). Phase 2 adds the pending / syncing / issue states. */
export function SyncBadge() {
  const t = useTranslations("status");
  const online = useConnectivity((s) => s.online);

  return (
    <Link href="/sync" aria-label={t(online ? "online" : "offline")}>
      <Badge variant="outline" className="h-7 gap-1.5 px-2.5">
        <span
          aria-hidden
          className={cn(
            "size-2 rounded-full",
            online ? "bg-emerald-500" : "bg-amber-500",
          )}
        />
        <span>{t(online ? "online" : "offline")}</span>
      </Badge>
    </Link>
  );
}
