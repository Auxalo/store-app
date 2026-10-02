"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import {
  type FilterField,
  type FilterValues,
  ListToolbar,
} from "@/components/shared/list-toolbar";
import { ListError, LoadMore } from "@/components/shared/load-more";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useList, useTotals } from "@/data/hooks";
import { useDataMode } from "@/data/mode-store";
import type { ListParamsInput } from "@/data/spec";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { presetRange } from "@/reports/use-summary";
import { PAYMENT_METHODS } from "@/schemas/sale";
import { usePreferences } from "@/stores/preferences";
import { useSyncStore } from "@/sync/store";

type Period = "today" | "week" | "all" | "custom";
const NONE = "all";
const SORTS = ["newest", "oldest", "total", "due"] as const;

export function SalesScreen() {
  const t = useTranslations();
  const f = useFormat();
  const timeZone = usePreferences((s) => s.timeZone);
  const mode = useDataMode();
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);

  const [period, setPeriod] = useState<Period>("today");
  const [search, setSearch] = useState("");
  const [q] = useDebounceValue(search.trim(), 200);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("newest");
  const [filters, setFilters] = useState<FilterValues>({
    status: NONE,
    method: NONE,
    dueOnly: false,
  });

  // A typed search looks through all time (an invoice number is found wherever it is);
  // otherwise the period applies, or the custom dates chosen in Filters.
  const dates = useMemo(() => {
    if (period === "custom")
      return {
        from: filters.from as string | undefined,
        to: filters.to as string | undefined,
      };
    if (q || period === "all") return {};
    return presetRange(period === "today" ? "today" : "days7", timeZone);
  }, [period, q, filters.from, filters.to, timeZone]);

  const params: ListParamsInput<"sales"> = {
    q,
    ...dates,
    status: filters.status as "all" | "active" | "voided",
    method:
      filters.method === NONE
        ? undefined
        : (filters.method as (typeof PAYMENT_METHODS)[number]),
    dueOnly: filters.dueOnly === true,
    sort,
  };
  const list = useList("sales", params);
  const totals = useTotals("sales", params);

  const fields: FilterField[] = [
    {
      kind: "dates",
      fromKey: "from",
      toKey: "to",
      label: t("sales.filterDates"),
    },
    {
      kind: "choice",
      key: "status",
      label: t("sales.filterStatus"),
      none: NONE,
      options: [
        { value: NONE, label: t("sales.statusAll") },
        { value: "active", label: t("sales.statusActive") },
        { value: "voided", label: t("sales.statusVoided") },
      ],
    },
    {
      kind: "choice",
      key: "method",
      label: t("sales.filterMethod"),
      none: NONE,
      options: [
        { value: NONE, label: t("sales.anyMethod") },
        ...PAYMENT_METHODS.map((m) => ({ value: m, label: t(`payment.${m}`) })),
      ],
    },
    { kind: "toggle", key: "dueOnly", label: t("sales.filterDue") },
  ];

  const clearFilters = () => {
    setFilters({ status: NONE, method: NONE, dueOnly: false });
    if (period === "custom") setPeriod("today");
  };
  const setFilter = (key: string, value: string | boolean | undefined) => {
    setFilters((current) => ({ ...current, [key]: value }));
    if (key === "from" || key === "to") setPeriod("custom");
  };

  const filtered =
    q !== "" ||
    period === "custom" ||
    filters.status !== NONE ||
    filters.method !== NONE ||
    filters.dueOnly === true;
  const waiting =
    list.status === "loading" ||
    (list.items.length === 0 && mode === "offline" && !initialSyncDone);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder={t("sales.searchPlaceholder")}
        fields={fields}
        values={
          period === "custom"
            ? filters
            : { ...filters, from: undefined, to: undefined }
        }
        onValue={setFilter}
        sort={sort}
        sortOptions={SORTS.map((s) => ({
          value: s,
          label: t(`sales.sort.${s}`),
        }))}
        onSort={(v) => setSort(v as (typeof SORTS)[number])}
        onClear={clearFilters}
      />

      {!q ? (
        <Tabs
          value={period === "custom" ? "" : period}
          onValueChange={(v) => setPeriod(v as Period)}
        >
          <TabsList>
            <TabsTrigger value="today">{t("sales.today")}</TabsTrigger>
            <TabsTrigger value="week">{t("sales.week")}</TabsTrigger>
            <TabsTrigger value="all">{t("sales.all")}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      {totals && totals.count > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span data-testid="sales-count">
            {t("sales.count", {
              count: totals.count,
              n: f.integer(totals.count),
            })}
          </span>
          <span
            className="font-semibold text-foreground"
            data-testid="sales-total"
          >
            {t("sales.totalSold", { value: f.money(totals.sold) })}
          </span>
        </div>
      ) : null}

      {list.status === "error" ? (
        <ListError onRetry={list.refetch} />
      ) : waiting ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : list.items.length === 0 ? (
        <p
          className="py-10 text-center text-sm text-muted-foreground"
          data-testid="sales-empty"
        >
          {filtered
            ? t("list.noMatch")
            : period === "all"
              ? t("sales.empty")
              : t("sales.emptyPeriod")}
        </p>
      ) : (
        <ul
          className={cn(
            "flex flex-col gap-2",
            list.isRefreshing && "opacity-60",
          )}
        >
          {list.items.map((s) => (
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
                    {s.customerPhone ? ` · ${s.customerPhone}` : ""}
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

      <LoadMore list={list} />
    </div>
  );
}
