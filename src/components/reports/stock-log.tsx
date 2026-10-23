"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { ListError, LoadMore } from "@/components/shared/load-more";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ListResult } from "@/data/hooks";
import { useUnits } from "@/hooks/use-units";
import { useFormat } from "@/i18n/use-format";
import { normalizeSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { DayRange } from "@/reports/compute";
import type { MovementRow } from "@/reports/movements";
import { useMovementSummary } from "@/reports/use-reports";

type View = "cards" | "log" | "both";
const VIEW_KEY = "reports.stockView";
const PAGE = 30;

function readView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "cards" || v === "log" || v === "both" ? v : "both";
  } catch {
    return "both";
  }
}

interface LogMovement {
  id: string;
  type: string;
  qtyDelta: number;
  createdAt: string;
  note?: string;
  productName?: string;
  productUnit?: string;
}

/**
 * The stock log: cards per product (how much came in, how much went out, in the chosen period) and
 * the movement-by-movement log below. A toggle shows only the cards, only the log, or both.
 */
export function StockLog({
  range,
  movements,
  csv,
}: {
  range: DayRange;
  movements: ListResult<LogMovement>;
  /** The log's export button. */
  csv: ReactNode;
}) {
  const t = useTranslations("reports");
  const ti = useTranslations("inventory");
  const tu = useUnits().name;
  const f = useFormat();
  const [view, setViewState] = useState<View>(readView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the choice just is not remembered */
    }
  };
  const summary = useMovementSummary(range, view !== "log");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const needle = normalizeSearch(search);
    const list = summary?.rows ?? [];
    return needle
      ? list.filter((r) => normalizeSearch(r.name).includes(needle))
      : list;
  }, [summary, search]);

  const side = (
    title: string,
    total: number,
    parts: Record<string, number>,
    row: MovementRow,
    sign: "+" | "−",
    testId: string,
  ) => (
    <div className="min-w-0" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{title}</p>
      <p
        className={cn(
          "font-semibold tabular-nums",
          total === 0 && "text-muted-foreground",
          sign === "−" && total > 0 && "text-destructive",
        )}
      >
        {total === 0 ? f.qty(0) : `${sign}${f.qty(Math.abs(total))}`}{" "}
        {tu(row.unit as never)}
      </p>
      <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
        {Object.entries(parts).map(([type, qty]) => (
          <li key={type} className="flex justify-between gap-2">
            <span className="truncate">
              {ti(`movementTypes.${type}` as never)}
            </span>
            <span className="tabular-nums">{f.qty(qty)}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="stock-log">
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList data-testid="stock-view">
          <TabsTrigger value="cards" data-testid="stock-view-cards">
            {t("stockViewCards")}
          </TabsTrigger>
          <TabsTrigger value="log" data-testid="stock-view-log">
            {t("stockViewLog")}
          </TabsTrigger>
          <TabsTrigger value="both" data-testid="stock-view-both">
            {t("stockViewBoth")}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view !== "log" ? (
        <Card data-testid="stock-cards">
          <CardHeader>
            <CardTitle className="text-base">{t("stockCardsTitle")}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {t("stockCardsHint")}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!summary ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setLimit(PAGE);
                    }}
                    placeholder={t("productSearch")}
                    aria-label={t("productSearch")}
                    className="ps-8"
                    data-testid="stock-search"
                  />
                </div>
                {rows.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {summary.rows.length === 0
                      ? t("movementEmpty")
                      : t("productNoMatch")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {rows.slice(0, limit).map((row) => {
                      const net = row.totalIn - row.totalOut;
                      return (
                        <li
                          key={row.productId}
                          className="rounded-xl border p-3 text-sm"
                          data-testid="stock-card"
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="truncate font-medium">
                              {row.name}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {t("stockNow")} {f.qty(row.stock)}{" "}
                              {tu(row.unit as never)}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {side(
                              t("stockIn"),
                              row.totalIn,
                              row.in,
                              row,
                              "+",
                              "stock-card-in",
                            )}
                            {side(
                              t("stockOut"),
                              row.totalOut,
                              row.out,
                              row,
                              "−",
                              "stock-card-out",
                            )}
                          </div>
                          <p
                            className="mt-2 border-t pt-1.5 text-xs text-muted-foreground"
                            data-testid="stock-card-net"
                          >
                            {t("stockNet")}{" "}
                            <span
                              className={cn(
                                "font-semibold tabular-nums",
                                net < 0 && "text-destructive",
                              )}
                            >
                              {net > 0 ? "+" : net < 0 ? "−" : ""}
                              {f.qty(Math.abs(net))} {tu(row.unit as never)}
                            </span>
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {rows.length > limit ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-center"
                    onClick={() => setLimit((l) => l + PAGE)}
                  >
                    {t("showMore")}
                  </Button>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {view !== "cards" ? (
        movements.status === "loading" ? (
          <Skeleton className="h-40 w-full" />
        ) : movements.status === "error" ? (
          <ListError onRetry={movements.refetch} />
        ) : (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">{t("tabs.movements")}</CardTitle>
              {csv}
            </CardHeader>
            <CardContent>
              {movements.items.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t("movementEmpty")}
                </p>
              ) : (
                <ul className="divide-y" data-testid="movement-rows">
                  {movements.items.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {m.productName ?? ""}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {ti(`movementTypes.${m.type}` as never)} ·{" "}
                          {f.dateTime(m.createdAt)}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 tabular-nums ${m.qtyDelta < 0 ? "text-destructive" : ""}`}
                      >
                        {m.qtyDelta > 0 ? "+" : ""}
                        {f.qty(m.qtyDelta)}
                        {m.productUnit ? ` ${tu(m.productUnit as never)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <LoadMore list={movements} />
            </CardContent>
          </Card>
        )
      ) : null}
    </div>
  );
}
