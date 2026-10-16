"use client";

import { ArrowDownLeft, ArrowUpRight, Ban, Wallet } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { EmptyState } from "@/components/shared/empty-state";
import {
  type FilterValues,
  ListToolbar,
} from "@/components/shared/list-toolbar";
import { ListError, LoadMore } from "@/components/shared/load-more";
import {
  type Period,
  PeriodChips,
  periodDates,
} from "@/components/shared/period-chips";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useList, useTotals } from "@/data/hooks";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";
import { CancelPaymentDialog } from "./cancel-payment-dialog";

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
  const timeZone = usePreferences((s) => s.timeZone);
  const [period, setPeriod] = useState<Period>("all");
  const [cancelling, setCancelling] = useState<{
    id: string;
    amount: number;
  } | null>(null);

  // Paying a supplier is for people who manage purchases; others only see money from customers.
  const type = can(role, "purchase.manage") ? filter : "customer";
  const dates =
    period === "custom"
      ? {
          from: filters.from as string | undefined,
          to: filters.to as string | undefined,
        }
      : periodDates(period, timeZone);
  const params = { type, ...dates, sort };
  const list = useList("payments", params);
  const totals = useTotals("payments", params);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <CancelPaymentDialog
        payment={cancelling}
        onClose={() => setCancelling(null)}
      />
      <ListToolbar
        fields={[
          {
            kind: "dates",
            fromKey: "from",
            toKey: "to",
            label: t("list.dates"),
          },
        ]}
        values={
          period === "custom"
            ? filters
            : { ...filters, from: undefined, to: undefined }
        }
        onValue={(key, value) => {
          setFilters((c) => ({ ...c, [key]: value }));
          if (key === "from" || key === "to") setPeriod("custom");
        }}
        sort={sort}
        sortOptions={SORTS.map((s) => ({
          value: s,
          label: t(`list.sorts.${s}`),
        }))}
        onSort={(v) => setSort(v as (typeof SORTS)[number])}
        onClear={() => {
          setFilters({});
          setPeriod("all");
        }}
      />
      <PeriodChips value={period} onChange={setPeriod} />
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
      <p className="text-xs text-muted-foreground">{t("payments.hint")}</p>
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
        <EmptyState
          icon={Wallet}
          title={t("payments.empty")}
          action={
            period !== "all" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPeriod("all")}
              >
                {t("list.showAll")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul
          className={cn(
            "flex flex-col gap-2",
            list.isRefreshing && "opacity-60",
          )}
        >
          {list.items.map((p) => {
            const incoming = p.partyType === "customer";
            const voided = p.status === "voided";
            return (
              <li
                key={p.id}
                className="flex items-center rounded-xl border bg-card"
              >
                <Link
                  href={`/${p.partyType}s/view?id=${p.partyId}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-3 hover:bg-muted/50"
                  data-testid="payment-row"
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full",
                      incoming
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "bg-amber-500/15 text-amber-600",
                    )}
                  >
                    {incoming ? (
                      <ArrowDownLeft className="size-5" aria-hidden />
                    ) : (
                      <ArrowUpRight className="size-5" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {p.partyName}
                      </span>
                      {voided ? (
                        <Badge variant="destructive" className="shrink-0">
                          {t("payments.voided")}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {f.dateTime(p.createdAt)} · {t(`payment.${p.method}`)}
                      {p.note ? ` · ${p.note}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span
                      className={cn(
                        "font-semibold",
                        incoming ? "text-emerald-600" : "text-amber-600",
                        voided && "line-through",
                      )}
                    >
                      {f.money(p.amount)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {incoming
                        ? t("payments.filterIn")
                        : t("payments.filterOut")}
                    </span>
                  </span>
                </Link>
                {!voided && can(role, "sale.void") ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="me-1 text-destructive"
                    aria-label={t("payments.voidConfirm")}
                    onClick={() =>
                      setCancelling({ id: p.id, amount: p.amount })
                    }
                    data-testid="cancel-payment"
                  >
                    <Ban aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <LoadMore list={list} />
    </div>
  );
}
