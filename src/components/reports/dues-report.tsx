"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { ListError, LoadMore } from "@/components/shared/load-more";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListResult } from "@/data/hooks";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { useDues } from "@/reports/use-reports";

interface Party {
  id: string;
  name: string;
  phone: string;
  balance: number;
}

function Summary({
  label,
  value,
  sub,
  tone,
  testId,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  tone: "owed" | "owe" | "advance";
  testId: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "owed" && "border-amber-500/40 bg-amber-500/10",
        tone === "owe" && "border-rose-500/40 bg-rose-500/10",
        tone === "advance" && "border-emerald-500/40 bg-emerald-500/10",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums" data-testid={testId}>
        {value}
      </p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function PartyList({
  title,
  total,
  list,
  href,
  testId,
}: {
  title: string;
  total: string;
  list: ListResult<Party>;
  href: string;
  testId: string;
}) {
  const t = useTranslations("reports");
  const f = useFormat();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <span className="font-semibold tabular-nums">{total}</span>
      </CardHeader>
      <CardContent>
        {list.status === "error" ? (
          <ListError onRetry={list.refetch} />
        ) : list.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("nobody")}</p>
        ) : (
          <ul className="divide-y" data-testid={testId}>
            {list.items.map((p) => (
              <li key={p.id}>
                <Link
                  href={`${href}?id=${p.id}`}
                  className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    {p.phone ? (
                      <span className="block text-xs text-muted-foreground">
                        {p.phone}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {f.money(p.balance)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <LoadMore list={list} />
      </CardContent>
    </Card>
  );
}

/**
 * Who owes the shop and whom the shop owes, easy to read and follow up: the totals first, then the
 * people (biggest first, with their phone and a link to their page), plus what is held in advance.
 */
export function DuesReport() {
  const t = useTranslations("reports");
  const f = useFormat();
  const [search, setSearch] = useState("");
  const [q] = useDebounceValue(search.trim(), 250);
  const dues = useDues(true, q);

  if (!dues.ready) return <Skeleton className="h-40 w-full" />;
  return (
    <div className="flex flex-col gap-3" data-testid="dues-report">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Summary
          tone="owed"
          label={t("customersOwe")}
          value={f.money(dues.customerTotal)}
          sub={t("peopleCount", { n: f.integer(dues.customerCount) })}
          testId="dues-customers-total"
        />
        <Summary
          tone="owe"
          label={t("weOwe")}
          value={f.money(dues.supplierTotal)}
          sub={t("peopleCount", { n: f.integer(dues.supplierCount) })}
          testId="dues-suppliers-total"
        />
        <Summary
          tone="advance"
          label={t("advancesHeld")}
          value={f.money(dues.customerAdvance + dues.supplierAdvance)}
          sub={[
            dues.customerAdvance > 0
              ? t("advanceCustomers", { value: f.money(dues.customerAdvance) })
              : "",
            dues.supplierAdvance > 0
              ? t("advanceSuppliers", { value: f.money(dues.supplierAdvance) })
              : "",
          ]
            .filter(Boolean)
            .join(" · ")}
          testId="dues-advances-total"
        />
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("duesSearch")}
          aria-label={t("duesSearch")}
          className="ps-8"
          data-testid="dues-search"
        />
      </div>

      <PartyList
        title={t("customersOwe")}
        total={f.money(dues.customerTotal)}
        list={dues.customers as ListResult<Party>}
        href="/customers/view"
        testId="dues-customer-rows"
      />
      <PartyList
        title={t("weOwe")}
        total={f.money(dues.supplierTotal)}
        list={dues.suppliers as ListResult<Party>}
        href="/suppliers/view"
        testId="dues-supplier-rows"
      />
    </div>
  );
}
