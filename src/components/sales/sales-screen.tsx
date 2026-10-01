"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLocalDb } from "@/db/local/db";
import { useFormat } from "@/i18n/use-format";
import { startOfStoreDay } from "@/lib/time";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";
import { useSyncStore } from "@/sync/store";

type Period = "today" | "week" | "all";
const PAGE = 50;

export function SalesScreen() {
  const t = useTranslations();
  const f = useFormat();
  const timeZone = usePreferences((s) => s.timeZone);
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);
  const [period, setPeriod] = useState<Period>("today");
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim());
  const [limit, setLimit] = useState(PAGE);

  const sales = useLiveQuery(async () => {
    const { sales: table } = getLocalDb();
    if (deferred)
      return table
        .where("invoiceNo")
        .startsWithIgnoreCase(deferred)
        .limit(limit)
        .toArray();
    const now = Date.now();
    const since =
      period === "today"
        ? startOfStoreDay(now, timeZone).toISOString()
        : period === "week"
          ? startOfStoreDay(now - 6 * 86_400_000, timeZone).toISOString()
          : null;
    const rows = since
      ? table.where("createdAt").aboveOrEqual(since)
      : table.orderBy("createdAt");
    return rows.reverse().limit(limit).toArray();
  }, [period, deferred, limit, timeZone]);

  const rows = sales ?? [];
  const active = rows.filter((s) => s.status === "active");
  const sold = active.reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("sales.searchPlaceholder")}
          aria-label={t("sales.searchPlaceholder")}
          className="ps-9"
          inputMode="search"
        />
      </div>

      {!deferred ? (
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            <TabsTrigger value="today">{t("sales.today")}</TabsTrigger>
            <TabsTrigger value="week">{t("sales.week")}</TabsTrigger>
            <TabsTrigger value="all">{t("sales.all")}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      {sales !== undefined && rows.length > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t("sales.count", {
              count: active.length,
              n: f.integer(active.length),
            })}
          </span>
          <span
            className="font-semibold text-foreground"
            data-testid="sales-total"
          >
            {t("sales.totalSold", { value: f.money(sold) })}
          </span>
        </div>
      ) : null}

      {sales === undefined || (!initialSyncDone && rows.length === 0) ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {deferred || period !== "all"
            ? t("sales.emptyPeriod")
            : t("sales.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sales/view?id=${s.id}`}
                className={cn(
                  "flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50",
                  s.status === "voided" && "opacity-60",
                )}
                data-testid="sale-row"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {s.invoiceNo}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {f.dateTime(s.createdAt)} ·{" "}
                    {s.customerName || t("pos.walkIn")}
                  </span>
                </span>
                {s.status === "voided" ? (
                  <Badge variant="destructive">{t("sales.voided")}</Badge>
                ) : null}
                {s.due > 0 && s.status === "active" ? (
                  <Badge variant="secondary">
                    {t("sales.dueBadge")} {f.money(s.due)}
                  </Badge>
                ) : null}
                <span
                  className={cn(
                    "shrink-0 font-semibold",
                    s.status === "voided" && "line-through",
                  )}
                >
                  {f.money(s.total)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {rows.length === limit ? (
        <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
          {t("sales.all")} +
        </Button>
      ) : null}
    </div>
  );
}
