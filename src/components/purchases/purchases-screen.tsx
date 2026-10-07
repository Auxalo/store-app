"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import {
  type FilterValues,
  ListToolbar,
} from "@/components/shared/list-toolbar";
import { ListError, LoadMore } from "@/components/shared/load-more";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useList, useTotals } from "@/data/hooks";
import { useDataMode } from "@/data/mode-store";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { useSyncStore } from "@/sync/store";

const SORTS = ["newest", "oldest", "total", "due"] as const;

export function PurchasesScreen() {
  const t = useTranslations();
  const f = useFormat();
  const { role } = useProfile();
  const mode = useDataMode();
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);
  const allowed = can(role, "purchase.manage");

  const [search, setSearch] = useState("");
  const [q] = useDebounceValue(search.trim(), 200);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("newest");
  const [filters, setFilters] = useState<FilterValues>({ dueOnly: false });

  const params = {
    q,
    from: filters.from as string | undefined,
    to: filters.to as string | undefined,
    dueOnly: filters.dueOnly === true,
    sort,
  };
  const list = useList("purchases", params, { enabled: allowed });
  const totals = useTotals("purchases", params, { enabled: allowed });
  const filtered =
    q !== "" || !!filters.from || !!filters.to || filters.dueOnly === true;

  if (!allowed)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.noAccess")}
      </p>
    );
  const waiting =
    list.status === "loading" ||
    (list.items.length === 0 && mode === "offline" && !initialSyncDone);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder={t("purchases.searchPlaceholder")}
        fields={[
          {
            kind: "dates",
            fromKey: "from",
            toKey: "to",
            label: t("list.dates"),
          },
          { kind: "toggle", key: "dueOnly", label: t("purchases.filterDue") },
        ]}
        values={filters}
        onValue={(key, value) => setFilters((c) => ({ ...c, [key]: value }))}
        sort={sort}
        sortOptions={SORTS.map((s) => ({
          value: s,
          label: t(`list.sorts.${s}`),
        }))}
        onSort={(v) => setSort(v as (typeof SORTS)[number])}
        onClear={() => setFilters({ dueOnly: false })}
        trailing={
          <Button asChild>
            <Link href="/purchases/new" data-testid="new-purchase">
              <Plus aria-hidden />
              <span className="max-sm:sr-only">{t("purchases.add")}</span>
            </Link>
          </Button>
        }
      />

      {totals && totals.count > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span data-testid="purchase-count">
            {t("purchases.count", {
              count: totals.count,
              n: f.integer(totals.count),
            })}
          </span>
          <span
            className="font-semibold text-foreground"
            data-testid="purchases-total"
          >
            {t("purchases.totalBought", { value: f.money(totals.total) })}
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
        <p className="py-10 text-center text-sm text-muted-foreground">
          {filtered ? t("purchases.emptyFilter") : t("purchases.empty")}
        </p>
      ) : (
        <ul
          className={cn(
            "flex flex-col gap-2",
            list.isRefreshing && "opacity-60",
          )}
        >
          {list.items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/purchases/view?id=${p.id}`}
                className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50"
                data-testid="purchase-row"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {p.purchaseNo}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {f.date(`${p.date}T12:00:00Z`)} ·{" "}
                    {p.supplierName || t("purchases.noSupplier")}
                    {p.invoiceRef ? ` · ${p.invoiceRef}` : ""}
                  </span>
                </span>
                {p.due > 0 ? (
                  <Badge variant="secondary">
                    {t("purchases.dueAtPurchase")} {f.money(p.due)}
                  </Badge>
                ) : null}
                <span className="shrink-0 font-semibold">
                  {f.money(p.total)}
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
