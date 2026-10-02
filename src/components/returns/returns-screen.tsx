"use client";

import { Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  type FilterValues,
  ListToolbar,
} from "@/components/shared/list-toolbar";
import { ListError, LoadMore } from "@/components/shared/load-more";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useList, useTotals } from "@/data/hooks";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";

const NONE = "all";
const SORTS = ["newest", "oldest", "total"] as const;

/** All returns. New returns start from the sale or purchase they belong to. */
export function ReturnsScreen() {
  const t = useTranslations();
  const f = useFormat();
  const [sort, setSort] = useState<(typeof SORTS)[number]>("newest");
  const [filters, setFilters] = useState<FilterValues>({ kind: NONE });

  const params = {
    kind: filters.kind as "all" | "sale" | "purchase",
    from: filters.from as string | undefined,
    to: filters.to as string | undefined,
    sort,
  };
  const list = useList("returns", params);
  const totals = useTotals("returns", params);
  const filtered = filters.kind !== NONE || !!filters.from || !!filters.to;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <ListToolbar
        fields={[
          {
            kind: "dates",
            fromKey: "from",
            toKey: "to",
            label: t("list.dates"),
          },
          {
            kind: "choice",
            key: "kind",
            label: t("returns.filterKind"),
            none: NONE,
            options: [
              { value: NONE, label: t("returns.kindAll") },
              { value: "sale", label: t("returns.saleKind") },
              { value: "purchase", label: t("returns.purchaseKind") },
            ],
          },
        ]}
        values={filters}
        onValue={(key, value) => setFilters((c) => ({ ...c, [key]: value }))}
        sort={sort}
        sortOptions={SORTS.map((s) => ({
          value: s,
          label: t(`list.sorts.${s}`),
        }))}
        onSort={(v) => setSort(v as (typeof SORTS)[number])}
        onClear={() => setFilters({ kind: NONE })}
      />

      {totals && totals.count > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span data-testid="return-count">
            {t("returns.count", {
              count: totals.count,
              n: f.integer(totals.count),
            })}
          </span>
          <span className="font-semibold text-foreground">
            {f.money(totals.total)}
          </span>
        </div>
      ) : null}

      {list.status === "error" ? (
        <ListError onRetry={list.refetch} />
      ) : list.status === "loading" ? (
        <Skeleton className="h-16 w-full" />
      ) : list.items.length === 0 ? (
        filtered ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("list.noMatch")}
          </p>
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <Undo2 className="size-8" aria-hidden />
            <p>{t("returns.empty")}</p>
          </div>
        )
      ) : (
        <ul
          className={cn(
            "flex flex-col gap-2",
            list.isRefreshing && "opacity-60",
          )}
        >
          {list.items.map((r) => (
            <li key={r.id}>
              <Link
                href={
                  r.kind === "sale"
                    ? `/sales/view?id=${r.refId}`
                    : `/purchases/view?id=${r.refId}`
                }
                className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50"
                data-testid="return-row"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {r.returnNo}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {f.dateTime(r.createdAt)} · {r.refNo}
                    {r.partyName ? ` · ${r.partyName}` : ""}
                  </span>
                </span>
                <Badge variant="secondary">
                  {r.kind === "sale"
                    ? t("returns.saleKind")
                    : t("returns.purchaseKind")}
                </Badge>
                <span className="shrink-0 font-semibold">
                  {f.money(r.total)}
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
