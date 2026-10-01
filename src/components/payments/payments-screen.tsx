"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLocalDb } from "@/db/local/db";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";

type Filter = "all" | "customer" | "supplier";

/** Every payment received from a customer or made to a supplier, newest first. */
export function PaymentsScreen() {
  const t = useTranslations();
  const f = useFormat();
  const [filter, setFilter] = useState<Filter>("all");

  const payments = useLiveQuery(async () => {
    const rows = getLocalDb().payments.orderBy("createdAt").reverse();
    return (
      filter === "all" ? rows : rows.filter((p) => p.partyType === filter)
    )
      .limit(200)
      .toArray();
  }, [filter]);
  const rows = payments ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="all">{t("payments.filterAll")}</TabsTrigger>
          <TabsTrigger value="customer">{t("payments.filterIn")}</TabsTrigger>
          <TabsTrigger value="supplier">{t("payments.filterOut")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-sm text-muted-foreground">{t("payments.hint")}</p>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/customers">{t("payments.goCustomers")}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/suppliers">{t("payments.goSuppliers")}</Link>
        </Button>
      </div>

      {payments === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("payments.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((p) => {
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
    </div>
  );
}
