"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  Banknote,
  ReceiptText,
  ShoppingBasket,
  TrendingUp,
  Truck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { BarChart } from "@/components/reports/bar-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLocalDb } from "@/db/local/db";
import { stockStatus } from "@/db/local/queries/products";
import { useFormat } from "@/i18n/use-format";
import { loadDues, loadStock } from "@/reports/local";
import { presetRange, useSummary } from "@/reports/use-summary";
import { usePreferences } from "@/stores/preferences";

/** The owner's morning view: today in numbers, what is running low, and the last few sales. */
export function DashboardScreen() {
  const t = useTranslations("dashboard");
  const tu = useTranslations("units");
  const f = useFormat();
  const { role } = useProfile();
  const timeZone = usePreferences((s) => s.timeZone);
  const locale = usePreferences((s) => s.locale);
  const [days, setDays] = useState<"days7" | "days30">("days7");

  const showProfit = can(role, "profit.view");
  const today = useSummary(presetRange("today", timeZone)).summary;
  const trend = useSummary(presetRange(days, timeZone)).summary;
  const dues = useLiveQuery(() => loadDues(getLocalDb()), []);
  const stock = useLiveQuery(() => loadStock(getLocalDb()), []);
  const recent = useLiveQuery(
    () =>
      getLocalDb()
        .sales.orderBy("createdAt")
        .reverse()
        .filter((s) => s.status === "active")
        .limit(6)
        .toArray(),
    [],
  );

  const low = (stock?.rows ?? [])
    .filter((r) => stockStatus(r) !== "ok")
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 6);

  const stats = [
    {
      key: "todaySales",
      icon: ReceiptText,
      value: today?.netSales,
      sub: today
        ? t("salesCount", {
            count: today.salesCount,
            n: f.integer(today.salesCount),
          })
        : "",
    },
    ...(showProfit
      ? [
          {
            key: "todayProfit",
            icon: TrendingUp,
            value: today?.netProfit,
            sub: "",
          },
        ]
      : []),
    { key: "todayExpenses", icon: Banknote, value: today?.expenses, sub: "" },
    {
      key: "todayPurchases",
      icon: ShoppingBasket,
      value: today?.purchasesTotal,
      sub: "",
    },
    { key: "customerDue", icon: Users, value: dues?.customerTotal, sub: "" },
    { key: "supplierDue", icon: Truck, value: dues?.supplierTotal, sub: "" },
  ] as const;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <Button asChild size="lg" className="h-12 text-base">
        <Link href="/pos" data-testid="open-pos">
          {t("openPos")}
        </Link>
      </Button>

      <div
        className="grid grid-cols-2 gap-2 md:grid-cols-3"
        data-testid="stats"
      >
        {stats.map((s) => (
          <Card key={s.key} size="sm">
            <CardContent className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <s.icon className="size-3.5" aria-hidden />
                {t(s.key as never)}
              </span>
              {s.value === undefined ? (
                <Skeleton className="h-6 w-20" />
              ) : (
                <span
                  className="text-lg font-semibold tabular-nums md:text-xl"
                  data-testid={`stat-${s.key}`}
                >
                  {f.money(s.value)}
                </span>
              )}
              {s.sub ? (
                <span className="text-xs text-muted-foreground">{s.sub}</span>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{t("chart")}</CardTitle>
          <Tabs value={days} onValueChange={(v) => setDays(v as typeof days)}>
            <TabsList>
              <TabsTrigger value="days7">{t("last7")}</TabsTrigger>
              <TabsTrigger value="days30">{t("last30")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {trend ? (
            <BarChart
              label={t("chart")}
              bars={trend.byDay.map((d) => ({
                day: d.day,
                value: Math.max(0, d.sales),
              }))}
            />
          ) : (
            <Skeleton className="h-36 w-full" />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-500" aria-hidden />
              {t("lowStock")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stock && low.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("lowStockEmpty")}
              </p>
            ) : null}
            <ul className="grid gap-1" data-testid="low-stock">
              {low.map((r) => (
                <li key={r.productId}>
                  <Link
                    href={`/products/view?id=${r.productId}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">
                      {locale === "bn" && r.nameBn ? r.nameBn : r.name}
                    </span>
                    <span
                      className={
                        r.stock <= 0
                          ? "shrink-0 text-destructive"
                          : "shrink-0 text-amber-600"
                      }
                    >
                      {r.stock <= 0
                        ? t("outOfStock")
                        : `${f.qty(r.stock)} ${tu(r.unit)}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">{t("recent")}</CardTitle>
            <Link href="/sales" className="text-sm text-primary">
              {t("seeAll")}
            </Link>
          </CardHeader>
          <CardContent>
            {recent && recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("recentEmpty")}
              </p>
            ) : null}
            <ul className="grid gap-1" data-testid="recent-sales">
              {recent?.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/sales/view?id=${s.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate">
                        {s.customerName || t("walkIn")}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {s.invoiceNo} · {f.dateTime(s.createdAt)}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {f.money(s.total)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
