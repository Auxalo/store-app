"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import {
  type FilterValues,
  ListToolbar,
} from "@/components/shared/list-toolbar";
import { ListError, LoadMore } from "@/components/shared/load-more";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useList, useTotals } from "@/data/hooks";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";

type Filter = "all" | "customer" | "supplier";
const SORTS = ["newest", "oldest", "amount"] as const;

/** Every payment received from a customer or made to a supplier. */
export function PaymentsScreen() {
  const t = useTranslations();
  const f = useFormat();
  const { role } = useProfile();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]>("newest");
  const [filters, setFilters] = useState<FilterValues>({});

  // Paying a supplier is for people who manage purchases; others only see money from customers.
  const type = can(role, "purchase.manage") ? filter : "customer";
  const params = {
    type,
    from: filters.from as string | undefined,
    to: filters.to as string | undefined,
    sort,
  };
  const list = useList("payments", params);
  const totals = useTotals("payments", params);

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
        ]}
        values={filters}
        onValue={(key, value) => setFilters((c) => ({ ...c, [key]: value }))}
        sort={sort}
        sortOptions={SORTS.map((s) => ({
          value: s,
          label: t(`list.sorts.${s}`),
        }))}
        onSort={(v) => setSort(v as (typeof SORTS)[number])}
        onClear={() => setFilters({})}
      />
      {can(role, "purchase.manage") ? (
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="all">{t("payments.filterAll")}</TabsTrigger>
            <TabsTrigger value="customer">{t("payments.filterIn")}</TabsTrigger>
            <TabsTrigger value="supplier">
              {t("payments.filterOut")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      <p className="text-sm text-muted-foreground">{t("payments.hint")}</p>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/customers">{t("payments.goCustomers")}</Link>
        </Button>
        {can(role, "purchase.manage") ? (
          <Button asChild variant="outline" size="sm">
            <Link href="/suppliers">{t("payments.goSuppliers")}</Link>
          </Button>
        ) : null}
      </div>

      {totals && totals.count > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span data-testid="payment-count">
            {t("payments.count", {
              count: totals.count,
              n: f.integer(totals.count),
            })}
          </span>
          <span className="font-semibold text-foreground">
            {f.money(totals.amount)}
          </span>
        </div>
      ) : null}

      {list.status === "error" ? (
        <ListError onRetry={list.refetch} />
      ) : list.status === "loading" ? (
        <Skeleton className="h-16 w-full" />
      ) : list.items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("payments.empty")}
        </p>
      ) : (
        <ul
          className={cn(
            "flex flex-col gap-2",
            list.isRefreshing && "opacity-60",
          )}
        >
          {list.items.map((p) => {
            const incoming = p.partyType === "customer";
            return (
              <li key={p.id}>
                <Link
                  href={`/${p.partyType}s/view?id=${p.partyId}`}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50"
                  data-testid="payment-row"
                >
                  {incoming ? (
                    <ArrowDownLeft
                      className="size-5 text-emerald-600"
                      aria-hidden
                    />
                  ) : (
                    <ArrowUpRight
                      className="size-5 text-amber-600"
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {incoming
                        ? t("payments.received", { name: p.partyName })
                        : t("payments.paidTo", { name: p.partyName })}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.dateTime(p.createdAt)} · {t(`payment.${p.method}`)}
                      {p.note ? ` · ${p.note}` : ""}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 font-semibold",
                      incoming ? "text-emerald-600" : "text-amber-600",
                    )}
                  >
                    {f.money(p.amount)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <LoadMore list={list} />
    </div>
  );
}
