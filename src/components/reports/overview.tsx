"use client";

import {
  Banknote,
  CreditCard,
  Hash,
  Package,
  ReceiptText,
  Star,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFormat } from "@/i18n/use-format";
import { changeBetween } from "@/reports/compare";
import type { Summary } from "@/reports/compute";
import { KpiCard } from "./kpi-card";

const METHOD_COLOUR: Record<string, string> = {
  cash: "bg-emerald-500",
  bkash: "bg-pink-500",
  nagad: "bg-orange-500",
  card: "bg-sky-500",
  other: "bg-slate-400",
};

export type OverviewTab = "sales" | "products" | "profit";

/**
 * The few numbers that matter for the tab being looked at, each in plain words with one line of
 * what it means, and (where it makes sense) how it moved against the same number of days just
 * before. Sales shows money in and who owes; Products shows what sold best; Profit shows what is
 * really kept after costs and expenses.
 */
export function ReportOverview({
  tab,
  summary,
  previous,
  showProfit,
  productName,
}: {
  tab: OverviewTab;
  summary: Summary;
  previous?: Summary;
  showProfit: boolean;
  productName: (p: { name: string; nameBn: string }) => string;
}) {
  const t = useTranslations("reports");
  const tp = useTranslations("payment");
  const tu = useTranslations("units");
  const f = useFormat();
  const s = summary;
  const vs = (pick: (x: Summary) => number) =>
    previous ? changeBetween(pick(s), pick(previous)) : undefined;
  const label = t("kpi.vsPrevious");
  const margin =
    s.netSales > 0 ? Math.round((s.profit / s.netSales) * 100) : null;
  const average = s.salesCount > 0 ? Math.round(s.total / s.salesCount) : 0;
  const ranked = [...s.byProduct].sort((a, b) => b.revenue - a.revenue);
  const top = ranked.slice(0, 5);
  const best = ranked[0];
  const methods = s.byPayment.filter((m) => m.total > 0);
  const methodTotal = methods.reduce((sum, m) => sum + m.total, 0);

  const cards =
    tab === "sales" ? (
      <>
        <KpiCard
          testId="kpi-net"
          label={t("kpi.totalSales")}
          hint={t("kpi.hint.totalSales")}
          icon={<ReceiptText className="size-3.5" aria-hidden />}
          value={f.money(s.netSales)}
          change={vs((x) => x.netSales)}
          changeLabel={label}
          spark={s.byDay.map((d) => d.sales)}
        />
        <KpiCard
          testId="kpi-count"
          label={t("kpi.numberOfSales")}
          hint={t("kpi.hint.numberOfSales")}
          icon={<Hash className="size-3.5" aria-hidden />}
          value={f.integer(s.salesCount)}
          sub={t("kpi.avgBill", { value: f.money(average) })}
          change={vs((x) => x.salesCount)}
          changeLabel={label}
          spark={s.byDay.map((d) => d.count)}
        />
        <KpiCard
          testId="kpi-credit"
          label={t("kpi.soldOnCredit")}
          hint={t("kpi.hint.soldOnCredit")}
          icon={<CreditCard className="size-3.5" aria-hidden />}
          value={f.money(s.due)}
          sub={t("kpi.received", { value: f.money(s.paid) })}
          change={vs((x) => x.due)}
          goodWhen="down"
          changeLabel={label}
        />
      </>
    ) : tab === "products" ? (
      <>
        <KpiCard
          testId="kpi-best"
          label={t("kpi.bestSeller")}
          hint={t("kpi.hint.bestSeller")}
          icon={<Star className="size-3.5" aria-hidden />}
          value={best ? productName(best) : t("kpi.none")}
          sub={
            best
              ? `${f.money(best.revenue)} · ${t("kpi.soldQty", { qty: `${f.qty(best.qty)} ${tu(best.unit)}` })}`
              : undefined
          }
          compactValue
        />
        <KpiCard
          testId="kpi-products"
          label={t("kpi.productsSold")}
          hint={t("kpi.hint.productsSold")}
          icon={<Package className="size-3.5" aria-hidden />}
          value={f.integer(ranked.length)}
        />
      </>
    ) : (
      <>
        {showProfit ? (
          <KpiCard
            testId="kpi-profit"
            label={t("profit")}
            hint={t("kpi.hint.profit")}
            icon={<TrendingUp className="size-3.5" aria-hidden />}
            value={f.money(s.profit)}
            sub={
              margin === null
                ? undefined
                : t("kpi.marginPlain", { n: f.integer(margin) })
            }
            change={vs((x) => x.profit)}
            changeLabel={label}
            spark={s.byDay.map((d) => d.profit)}
          />
        ) : null}
        <KpiCard
          testId="kpi-expenses"
          label={t("expenses")}
          hint={t("kpi.hint.expenses")}
          icon={<Banknote className="size-3.5" aria-hidden />}
          value={f.money(s.expenses)}
          change={vs((x) => x.expenses)}
          goodWhen="down"
          changeLabel={label}
        />
        {showProfit ? (
          <KpiCard
            testId="kpi-netprofit"
            label={t("kpi.keep")}
            hint={t("kpi.hint.keep")}
            icon={<Wallet className="size-3.5" aria-hidden />}
            value={f.money(s.netProfit)}
            change={vs((x) => x.netProfit)}
            changeLabel={label}
          />
        ) : null}
      </>
    );

  return (
    <div className="flex flex-col gap-3" data-testid="report-overview">
      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 md:grid-cols-3">
        {cards}
      </div>

      {tab === "sales" && methodTotal > 0 ? (
        <Card size="sm" data-testid="payment-split">
          <CardHeader>
            <CardTitle className="text-sm">{t("kpi.paymentSplit")}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("kpi.hint.paymentSplit")}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              {methods.map((m) => (
                <div
                  key={m.method}
                  className={METHOD_COLOUR[m.method] ?? "bg-slate-400"}
                  style={{ width: `${(m.total / methodTotal) * 100}%` }}
                  title={`${tp(m.method)}: ${f.money(m.total)}`}
                />
              ))}
            </div>
            <ul className="flex flex-col gap-1 text-sm">
              {methods.map((m) => (
                <li key={m.method} className="flex items-center gap-2">
                  <span
                    className={`size-2.5 rounded-full ${METHOD_COLOUR[m.method] ?? "bg-slate-400"}`}
                    aria-hidden
                  />
                  <span className="flex-1">{tp(m.method)}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {f.integer(Math.round((m.total / methodTotal) * 100))}%
                  </span>
                  <span className="w-24 text-end font-medium tabular-nums">
                    {f.money(m.total)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {tab === "products" && top.length > 0 ? (
        <Card size="sm" data-testid="top-products">
          <CardHeader>
            <CardTitle className="text-sm">{t("kpi.topProducts")}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("kpi.hint.topProducts")}
            </p>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-1.5 text-sm">
              {top.map((p, i) => (
                <li key={p.productId} className="flex items-center gap-2">
                  <span className="w-4 text-muted-foreground">
                    {f.integer(i + 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {productName(p)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {f.qty(p.qty)} {tu(p.unit)}
                  </span>
                  <span className="font-medium tabular-nums">
                    {f.money(p.revenue)}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
