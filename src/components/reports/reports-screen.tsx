"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLocalDb } from "@/db/local/db";
import { stockStatus } from "@/db/local/queries/products";
import { useFormat } from "@/i18n/use-format";
import { download, toCsv } from "@/lib/export";
import { rangeBounds, type Summary } from "@/reports/compute";
import { loadDues, loadStock } from "@/reports/local";
import {
  presetRange,
  type ReportSource,
  useSummary,
} from "@/reports/use-summary";
import { usePreferences } from "@/stores/preferences";
import { BarChart } from "./bar-chart";
import { RangePicker, type RangeState, rangeOf } from "./range-picker";

type Tab = "sales" | "products" | "profit" | "stock" | "dues" | "movements";
const TABS: Tab[] = [
  "sales",
  "products",
  "profit",
  "stock",
  "dues",
  "movements",
];
const MOVEMENT_LIMIT = 300;

function Row({
  label,
  value,
  bold,
  testId,
}: {
  label: string;
  value: ReactNode;
  bold?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-1.5 text-sm ${bold ? "font-semibold" : ""}`}
    >
      <span className={bold ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Reports for any date range. Everything is computed on this device, so it works offline. */
export function ReportsScreen() {
  const t = useTranslations("reports");
  const ti = useTranslations("inventory");
  const tu = useTranslations("units");
  const tp = useTranslations("payment");
  const te = useTranslations("expenses.categories");
  const f = useFormat();
  const { role } = useProfile();
  const timeZone = usePreferences((s) => s.timeZone);
  const locale = usePreferences((s) => s.locale);

  const [tab, setTab] = useState<Tab>("sales");
  const [rangeState, setRangeState] = useState<RangeState>(() => {
    const today = presetRange("today", timeZone);
    return { preset: "days7", custom: today };
  });
  const [source, setSource] = useState<ReportSource>("device");
  const range = rangeOf(rangeState, timeZone);
  const { summary, serverFailed } = useSummary(range, source);

  const showProfit = can(role, "profit.view");
  const categories = useLiveQuery(() => getLocalDb().categories.toArray(), []);
  const categoryName = (id: string | null) => {
    const c = categories?.find((x) => x.id === id);
    return c
      ? locale === "bn" && c.nameBn
        ? c.nameBn
        : c.name
      : t("uncategorized");
  };
  const productName = (p: { name: string; nameBn: string }) =>
    locale === "bn" && p.nameBn ? p.nameBn : p.name;

  const stock = useLiveQuery(() => loadStock(getLocalDb()), []);
  const dues = useLiveQuery(() => loadDues(getLocalDb()), []);
  const movements = useLiveQuery(async () => {
    const { start, end } = rangeBounds(range, timeZone);
    const db = getLocalDb();
    const rows = await db.stockMovements
      .where("createdAt")
      .between(start, end, true, false)
      .reverse()
      .limit(MOVEMENT_LIMIT)
      .toArray();
    const products = await db.products.bulkGet([
      ...new Set(rows.map((r) => r.productId)),
    ]);
    const names = new Map(
      products.filter((p) => !!p).map((p) => [p?.id, p ? productName(p) : ""]),
    );
    return rows.map((r) => ({ ...r, name: names.get(r.productId) ?? "" }));
  }, [range.from, range.to, timeZone, locale]);
  const [onlyLow, setOnlyLow] = useState(false);

  const exportCsv = (
    name: string,
    rows: Array<Record<string, unknown>>,
    columns: string[],
  ) =>
    download(
      `${name}-${range.from}_${range.to}.csv`,
      toCsv(rows, columns),
      "text/csv",
    );

  const csvButton = (onClick: () => void) => (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      data-testid="export-csv"
    >
      <Download aria-hidden />
      {t("export")}
    </Button>
  );

  const empty = (
    <p className="py-4 text-center text-sm text-muted-foreground">
      {t("noData")}
    </p>
  );
  const loading = <Skeleton className="h-40 w-full" />;
  const needsSummary =
    tab === "sales" || tab === "products" || tab === "profit";

  function salesTab(s: Summary) {
    return (
      <>
        <Section title={t("tabs.sales")}>
          <Row
            label={t("salesCount")}
            value={f.integer(s.salesCount)}
            testId="r-count"
          />
          <Row label={t("subtotal")} value={f.money(s.subtotal)} />
          <Row label={t("discount")} value={f.money(s.discount)} />
          <Row label={t("total")} value={f.money(s.total)} testId="r-total" />
          <Row
            label={t("returns")}
            value={f.money(s.returns)}
            testId="r-returns"
          />
          <Row
            label={t("netSales")}
            value={f.money(s.netSales)}
            bold
            testId="r-net"
          />
          <Row label={t("paid")} value={f.money(s.paid)} />
          <Row label={t("credit")} value={f.money(s.due)} />
        </Section>
        <Section
          title={t("byDay")}
          action={csvButton(() =>
            exportCsv("sales-by-day", s.byDay as never, [
              "day",
              "count",
              "sales",
              ...(showProfit ? ["profit"] : []),
            ]),
          )}
        >
          <BarChart
            label={t("byDay")}
            bars={s.byDay.map((d) => ({
              day: d.day,
              value: Math.max(0, d.sales),
            }))}
          />
        </Section>
        <Section title={t("byPayment")}>
          {s.byPayment.length === 0
            ? empty
            : s.byPayment.map((p) => (
                <Row
                  key={p.method}
                  label={`${tp(p.method)} · ${f.integer(p.count)}`}
                  value={f.money(p.total)}
                />
              ))}
        </Section>
      </>
    );
  }

  function productsTab(s: Summary) {
    return (
      <>
        <Section
          title={t("bestSellers")}
          action={csvButton(() =>
            exportCsv(
              "products",
              s.byProduct.map((p) => ({
                name: p.name,
                qty: p.qty / 1000,
                unit: p.unit,
                revenue: p.revenue / 100,
                ...(showProfit ? { profit: p.profit / 100 } : {}),
              })),
              [
                "name",
                "qty",
                "unit",
                "revenue",
                ...(showProfit ? ["profit"] : []),
              ],
            ),
          )}
        >
          {s.byProduct.length === 0 ? (
            empty
          ) : (
            <ul className="divide-y" data-testid="product-rows">
              {s.byProduct.slice(0, 50).map((p) => (
                <li
                  key={p.productId}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {productName(p)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("qtySold")} {f.qty(p.qty)} {tu(p.unit)}
                    </span>
                  </span>
                  <span className="shrink-0 text-end tabular-nums">
                    <span className="block">{f.money(p.revenue)}</span>
                    {showProfit ? (
                      <span className="block text-xs text-muted-foreground">
                        {f.money(p.profit)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title={t("byCategory")}>
          {s.byCategory.length === 0
            ? empty
            : s.byCategory.map((c) => (
                <Row
                  key={c.categoryId ?? "none"}
                  label={categoryName(c.categoryId)}
                  value={f.money(c.revenue)}
                />
              ))}
        </Section>
      </>
    );
  }

  function profitTab(s: Summary) {
    return (
      <>
        <Section title={t("tabs.profit")}>
          <Row label={t("netSales")} value={f.money(s.netSales)} />
          {showProfit ? (
            <>
              <Row label={t("cost")} value={f.money(s.cost)} />
              <Row
                label={t("profit")}
                value={f.money(s.profit)}
                bold
                testId="r-profit"
              />
            </>
          ) : (
            <p className="py-1 text-xs text-muted-foreground">
              {t("profitHidden")}
            </p>
          )}
          <Row
            label={t("expenses")}
            value={f.money(s.expenses)}
            testId="r-expenses"
          />
          {showProfit ? (
            <Row
              label={t("netProfit")}
              value={f.money(s.netProfit)}
              bold
              testId="r-netprofit"
            />
          ) : null}
        </Section>
        <Section title={t("expensesByCategory")}>
          {s.expensesByCategory.length === 0
            ? empty
            : s.expensesByCategory.map((e) => (
                <Row
                  key={e.category}
                  label={te(e.category as never)}
                  value={f.money(e.total)}
                />
              ))}
        </Section>
        <Section title={t("purchases")}>
          <Row
            label={t("purchases")}
            value={`${f.money(s.purchasesTotal)} · ${f.integer(s.purchasesCount)}`}
            testId="r-purchases"
          />
          <Row label={t("purchasesDue")} value={f.money(s.purchasesDue)} />
        </Section>
      </>
    );
  }

  const stockRows = (stock?.rows ?? []).filter(
    (r) => !onlyLow || stockStatus(r) !== "ok",
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="overflow-x-auto pb-1">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            {TABS.map((id) => (
              <TabsTrigger
                key={id}
                value={id}
                className="px-3"
                data-testid={`tab-${id}`}
              >
                {t(`tabs.${id}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {tab !== "stock" && tab !== "dues" ? (
        <RangePicker value={rangeState} onChange={setRangeState} />
      ) : null}

      {needsSummary ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("source")}</span>
          <Tabs
            value={source}
            onValueChange={(v) => setSource(v as ReportSource)}
          >
            <TabsList>
              <TabsTrigger value="device" data-testid="source-device">
                {t("sourceDevice")}
              </TabsTrigger>
              <TabsTrigger value="server" data-testid="source-server">
                {t("sourceServer")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      ) : null}
      {serverFailed && needsSummary ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs"
        >
          {t("serverFailed")}
        </p>
      ) : null}

      {needsSummary
        ? !summary
          ? loading
          : tab === "sales"
            ? salesTab(summary)
            : tab === "products"
              ? productsTab(summary)
              : profitTab(summary)
        : null}

      {tab === "stock" ? (
        !stock ? (
          loading
        ) : (
          <>
            <Section title={t("tabs.stock")}>
              <Row
                label={t("costValue")}
                value={f.money(stock.costValue)}
                testId="r-stock-cost"
              />
              <Row
                label={t("retailValue")}
                value={f.money(stock.retailValue)}
              />
              <Row label={t("lowCount")} value={f.integer(stock.lowCount)} />
              <Row label={t("outCount")} value={f.integer(stock.outCount)} />
            </Section>
            <Section
              title={t("product")}
              action={
                <span className="flex items-center gap-2">
                  <Button
                    variant={onlyLow ? "default" : "outline"}
                    size="sm"
                    onClick={() => setOnlyLow((v) => !v)}
                    data-testid="only-low"
                  >
                    {t("onlyLow")}
                  </Button>
                  {csvButton(() =>
                    exportCsv(
                      "stock",
                      stockRows.map((r) => ({
                        name: r.name,
                        unit: r.unit,
                        stock: r.stock / 1000,
                        costValue: r.costValue / 100,
                        retailValue: r.retailValue / 100,
                      })),
                      ["name", "unit", "stock", "costValue", "retailValue"],
                    ),
                  )}
                </span>
              }
            >
              {stockRows.length === 0 ? (
                empty
              ) : (
                <ul className="divide-y" data-testid="stock-rows">
                  {stockRows.map((r) => (
                    <li
                      key={r.productId}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">{productName(r)}</span>
                      <span
                        className={`shrink-0 tabular-nums ${stockStatus(r) === "out" ? "text-destructive" : stockStatus(r) === "low" ? "text-amber-600" : ""}`}
                      >
                        {f.qty(r.stock)} {tu(r.unit)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </>
        )
      ) : null}

      {tab === "dues" ? (
        !dues ? (
          loading
        ) : (
          <>
            <Section
              title={`${t("customersOwe")} · ${f.money(dues.customerTotal)}`}
            >
              {dues.customers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("nobody")}</p>
              ) : (
                dues.customers.map((c) => (
                  <Row key={c.id} label={c.name} value={f.money(c.amount)} />
                ))
              )}
            </Section>
            <Section title={`${t("weOwe")} · ${f.money(dues.supplierTotal)}`}>
              {dues.suppliers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("nobody")}</p>
              ) : (
                dues.suppliers.map((c) => (
                  <Row key={c.id} label={c.name} value={f.money(c.amount)} />
                ))
              )}
            </Section>
          </>
        )
      ) : null}

      {tab === "movements" ? (
        !movements ? (
          loading
        ) : (
          <Section
            title={t("tabs.movements")}
            action={csvButton(() =>
              exportCsv(
                "stock-log",
                movements.map((m) => ({
                  date: m.createdAt,
                  product: m.name,
                  type: m.type,
                  change: m.qtyDelta / 1000,
                  note: m.note,
                })),
                ["date", "product", "type", "change", "note"],
              ),
            )}
          >
            {movements.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t("movementEmpty")}
              </p>
            ) : (
              <ul className="divide-y" data-testid="movement-rows">
                {movements.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {m.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {ti(`movementTypes.${m.type}`)} ·{" "}
                        {f.dateTime(m.createdAt)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 tabular-nums ${m.qtyDelta < 0 ? "text-destructive" : ""}`}
                    >
                      {m.qtyDelta > 0 ? "+" : ""}
                      {f.qty(m.qtyDelta)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {movements.length >= MOVEMENT_LIMIT ? (
              <p className="pt-2 text-xs text-muted-foreground">
                {t("movementLimit", { n: f.integer(MOVEMENT_LIMIT) })}
              </p>
            ) : null}
          </Section>
        )
      ) : null}
    </div>
  );
}
