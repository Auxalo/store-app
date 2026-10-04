"use client";

import {
  AlertTriangle,
  Banknote,
  ReceiptText,
  ShoppingBasket,
  TrendingUp,
  type Users,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { BarChart } from "@/components/reports/bar-chart";
import { KpiCard } from "@/components/reports/kpi-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOnlineDashboard } from "@/data/dashboard";
import { useList, useTotals } from "@/data/hooks";
import { useDataMode } from "@/data/mode-store";
import { useSetting } from "@/hooks/use-setting";
import { useFormat } from "@/i18n/use-format";
import { SETUP_SETTING } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { changeBetween } from "@/reports/compare";
import { useStockHeader } from "@/reports/use-reports";
import { presetRange, useSummary } from "@/reports/use-summary";
import { usePreferences } from "@/stores/preferences";
import { StoreWorth } from "./store-worth";

/** The owner's morning view: today in numbers, what is running low, and the last few sales. */
export function DashboardScreen() {
  const t = useTranslations("dashboard");
  const tk = useTranslations("reports.kpi");
  const tu = useTranslations("units");
  const f = useFormat();
  const { role } = useProfile();
  const timeZone = usePreferences((s) => s.timeZone);
  const locale = usePreferences((s) => s.locale);
  const [days, setDays] = useState<"days7" | "days30">("days7");

  const showProfit = can(role, "profit.view");
  // The worth figures are made of cost prices, so they go only to people who may see those.
  const showWorth = can(role, "purchasePrice.view");
  const ts = useTranslations("setup");
  // Owners are reminded to set up until they finish or skip it (the setting is empty until then).
  const setupDone = useSetting<string>(SETUP_SETTING, "").value;
  const showSetup = can(role, "settings.manage") && !setupDone;
  // Online: the whole dashboard is one request. On the device each piece is read locally (the
  // hooks below are switched off in online mode, and the one request is switched off offline).
  const online = useDataMode() === "online";
  const remote = useOnlineDashboard(online, days);
  const todayLocal = useSummary(
    presetRange("today", timeZone),
    "device",
    !online,
  ).summary;
  const yesterdayLocal = useSummary(
    presetRange("yesterday", timeZone),
    "device",
    !online,
  ).summary;
  const trendLocal = useSummary(
    presetRange(days, timeZone),
    "device",
    !online,
  ).summary;
  const customerDuesLocal = useTotals("customers", {}, { enabled: !online });
  const supplierDuesLocal = useTotals("suppliers", {}, { enabled: !online });
  const stockLocal = useStockHeader(!online && showWorth);
  const lowLocal = useList(
    "products",
    { stock: "low", active: "active", sort: "stock" },
    { pageSize: 6, enabled: !online },
  );
  const recentLocal = useList(
    "sales",
    { status: "active", sort: "newest" },
    { pageSize: 6, enabled: !online },
  );
  const today = online ? remote.data?.today : todayLocal;
  const yesterday = online ? remote.data?.yesterday : yesterdayLocal;
  const trend = online ? remote.data?.trend : trendLocal;
  const customerDues = online
    ? remote.data && {
        owed: remote.data.customerOwed,
        advance: remote.data.customerAdvance,
      }
    : customerDuesLocal;
  const supplierDues = online
    ? remote.data && {
        owed: remote.data.supplierOwed,
        advance: remote.data.supplierAdvance,
      }
    : supplierDuesLocal;
  const stock = online ? remote.data?.stock : stockLocal;
  const worthFigures =
    stock && customerDues && supplierDues
      ? {
          stockCost: stock.costValue,
          stockRetail: stock.retailValue,
          customersOwed: customerDues.owed ?? 0,
          customersAdvance: customerDues.advance ?? 0,
          suppliersOwed: supplierDues.owed ?? 0,
          suppliersAdvance: supplierDues.advance ?? 0,
        }
      : undefined;
  const lowReady = online ? !!remote.data : lowLocal.status === "ready";
  const recent = {
    items: online ? (remote.data?.recent ?? []) : recentLocal.items,
    status: online ? (remote.data ? "ready" : "loading") : recentLocal.status,
  };
  const low = online ? (remote.data?.low ?? []) : lowLocal.items;

  const vs = (pick: (x: NonNullable<typeof today>) => number) =>
    today && yesterday
      ? changeBetween(pick(today), pick(yesterday))
      : undefined;

  const stats: Array<{
    key: string;
    icon: typeof Users;
    value: number | undefined;
    sub: string;
    change?: ReturnType<typeof changeBetween>;
    goodWhen?: "up" | "down";
    spark?: number[];
  }> = [
    {
      key: "todaySales",
      icon: ReceiptText,
      value: today?.netSales,
      change: vs((x) => x.netSales),
      spark: trend?.byDay.map((d) => d.sales),
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
            change: vs((x) => x.netProfit),
            spark: trend?.byDay.map((d) => d.profit),
            sub: "",
          },
        ]
      : []),
    {
      key: "todayExpenses",
      icon: Banknote,
      value: today?.expenses,
      change: vs((x) => x.expenses),
      goodWhen: "down",
      sub: "",
    },
    {
      key: "todayPurchases",
      icon: ShoppingBasket,
      value: today?.purchasesTotal,
      change: vs((x) => x.purchasesTotal),
      sub: "",
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      {showSetup ? (
        <Card
          className="border-primary/40 bg-primary/5"
          data-testid="setup-banner"
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{ts("banner")}</p>
              <p className="text-sm text-muted-foreground">
                {ts("bannerBody")}
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/settings/setup">{ts("bannerAction")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Button asChild size="lg" className="h-14 text-lg">
        <Link href="/pos" data-testid="open-pos">
          {t("openPos")}
        </Link>
      </Button>

      <div
        className={cn(
          "grid grid-cols-2 gap-2",
          stats.length === 4 ? "md:grid-cols-4" : "md:grid-cols-3",
        )}
        data-testid="stats"
      >
        {stats.map((st) => (
          <KpiCard
            key={st.key}
            label={t(st.key as never)}
            icon={<st.icon className="size-3.5" aria-hidden />}
            value={st.value === undefined ? undefined : f.money(st.value)}
            valueTestId={`stat-${st.key}`}
            sub={st.sub || undefined}
            change={st.change}
            goodWhen={st.goodWhen}
            changeLabel={tk("vsYesterday")}
            spark={st.spark}
          />
        ))}
      </div>

      {showWorth ? <StoreWorth figures={worthFigures} /> : null}

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
            {lowReady && low.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("lowStockEmpty")}
              </p>
            ) : null}
            <ul className="grid gap-1" data-testid="low-stock">
              {low.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/products/view?id=${r.id}`}
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
            {recent.status === "ready" && recent.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("recentEmpty")}
              </p>
            ) : null}
            <ul className="grid gap-1" data-testid="recent-sales">
              {recent.items.map((s) => (
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
