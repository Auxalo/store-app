"use client";

import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { METHOD_COLOUR } from "@/components/reports/overview";
import {
  RangePicker,
  type RangeState,
  rangeOf,
} from "@/components/reports/range-picker";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import type { CashFlow } from "@/reports/cash";
import { useMoneyFlow } from "@/reports/use-cash";
import { presetRange, type RangePreset } from "@/reports/use-summary";
import { PAYMENT_METHODS } from "@/schemas/sale";
import { usePreferences } from "@/stores/preferences";

const PRESETS: RangePreset[] = [
  "today",
  "yesterday",
  "days7",
  "thisMonth",
  "custom",
];

type InKey = "sales" | "customerPayments" | "supplierRefunds";
type OutKey = "purchases" | "supplierPayments" | "expenses" | "customerRefunds";
const IN_KEYS: InKey[] = ["sales", "customerPayments", "supplierRefunds"];
const OUT_KEYS: OutKey[] = [
  "purchases",
  "supplierPayments",
  "expenses",
  "customerRefunds",
];

/**
 * Money in and out: how much really came in and went out over the days picked, what each way of
 * paying (cash, bKash, Nagad, bank...) carried, and where the money came from and went to. Only
 * what was actually handed over counts: a ৳7,000 bill paid ৳5,000 is ৳5,000 in.
 */
export function MoneyScreen() {
  const t = useTranslations("money");
  const f = useFormat();
  const timeZone = usePreferences((s) => s.timeZone);
  const [state, setState] = useState<RangeState>(() => ({
    preset: "today",
    custom: presetRange("today", timeZone),
  }));
  const range = rangeOf(state, timeZone);
  const flow = useMoneyFlow(range);

  const methods = flow
    ? PAYMENT_METHODS.filter(
        (m) => flow.methods[m].totalIn !== 0 || flow.methods[m].totalOut !== 0,
      )
    : [];
  const biggest = flow
    ? Math.max(
        1,
        ...methods.map((m) =>
          Math.max(
            Math.abs(flow.methods[m].totalIn),
            Math.abs(flow.methods[m].totalOut),
          ),
        ),
      )
    : 1;
  const empty = flow && flow.all.totalIn === 0 && flow.all.totalOut === 0;

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-4"
      data-testid="money-screen"
    >
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      <RangePicker value={state} onChange={setState} presets={PRESETS} />

      {!flow ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : empty ? (
        <EmptyState
          icon={ArrowLeftRight}
          title={t("empty")}
          hint={t("emptyHint")}
          testId="money-empty"
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <FlowCard
              direction="in"
              total={flow.all.totalIn}
              rows={IN_KEYS.map((k) => ({
                key: k,
                label: t(`kinds.${k}`),
                value: flow.all[k],
              }))}
            />
            <FlowCard
              direction="out"
              total={flow.all.totalOut}
              rows={OUT_KEYS.map((k) => ({
                key: k,
                label: t(`kinds.${k}`),
                value: flow.all[k],
              }))}
            />
          </div>
          <p
            className="text-center text-sm text-muted-foreground"
            data-testid="money-net"
          >
            {t("net")}:{" "}
            <span
              className={cn(
                "font-semibold tabular-nums",
                flow.all.totalIn - flow.all.totalOut < 0
                  ? "text-destructive"
                  : "text-foreground",
              )}
            >
              {f.money(flow.all.totalIn - flow.all.totalOut, "auto")}
            </span>
          </p>

          <Card data-testid="money-methods">
            <CardHeader>
              <CardTitle className="text-base">{t("fromWhere")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {methods.map((m) => (
                <MethodRow
                  key={m}
                  method={m}
                  flow={flow.methods[m]}
                  biggest={biggest}
                />
              ))}
              <p className="text-xs text-muted-foreground">{t("cancelNote")}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function FlowCard({
  direction,
  total,
  rows,
}: {
  direction: "in" | "out";
  total: number;
  rows: Array<{ key: string; label: string; value: number }>;
}) {
  const t = useTranslations("money");
  const f = useFormat();
  const incoming = direction === "in";
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <Card
      className={cn(
        "border-l-4",
        incoming ? "border-l-emerald-500" : "border-l-rose-500",
      )}
      data-testid={`money-${direction}`}
    >
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-full",
              incoming
                ? "bg-emerald-500/15 text-emerald-600"
                : "bg-rose-500/15 text-rose-600",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </span>
          <span className="text-sm font-medium text-muted-foreground">
            {t(incoming ? "in" : "out")}
          </span>
        </div>
        <p
          className="text-3xl font-bold tabular-nums"
          data-testid={`money-${direction}-total`}
        >
          {f.money(total)}
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {rows
            .filter((r) => r.value !== 0)
            .map((r) => (
              <li
                key={r.key}
                className="flex items-center justify-between gap-2"
                data-testid={`money-${direction}-${r.key}`}
              >
                <span className="text-muted-foreground">{r.label}</span>
                <span className="tabular-nums">{f.money(r.value, "auto")}</span>
              </li>
            ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function MethodRow({
  method,
  flow,
  biggest,
}: {
  method: string;
  flow: CashFlow;
  biggest: number;
}) {
  const tp = useTranslations("payment");
  const t = useTranslations("money");
  const f = useFormat();
  const width = (v: number) =>
    `${Math.min(100, Math.max(v === 0 ? 0 : 3, (Math.abs(v) / biggest) * 100))}%`;
  return (
    <div
      className="flex flex-col gap-1.5"
      data-testid={`money-method-${method}`}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <span
          className={cn("size-2.5 rounded-full", METHOD_COLOUR[method])}
          aria-hidden
        />
        {tp(method as never)}
      </div>
      {(["in", "out"] as const).map((dir) => {
        const value = dir === "in" ? flow.totalIn : flow.totalOut;
        return (
          <div key={dir} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 text-muted-foreground">
              {t(dir)}
            </span>
            <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  dir === "in" ? "bg-emerald-500" : "bg-rose-500",
                )}
                style={{ width: width(value) }}
              />
            </div>
            <span
              className="w-24 shrink-0 text-end tabular-nums"
              data-testid={`money-method-${method}-${dir}`}
            >
              {f.money(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
