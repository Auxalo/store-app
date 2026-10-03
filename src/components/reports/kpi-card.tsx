"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import type { Change } from "@/reports/compare";

/** A tiny line of how the number moved day by day, in plain SVG (no chart library). */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 22 - ((v - min) / span) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="h-6 w-full text-primary/70"
      aria-hidden
      data-testid="sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * How the number changed against the period before. `goodWhen` says which way is good news
 * (more sales is good, more expenses is not), so the colour means the same thing on every card.
 */
export function ChangeChip({
  change,
  goodWhen = "up",
  label,
}: {
  change: Change;
  goodWhen?: "up" | "down";
  label: string;
}) {
  const t = useTranslations("reports.kpi");
  const f = useFormat();
  const good =
    change.kind === "up" || change.kind === "down"
      ? change.kind === goodWhen
      : null;
  const tone =
    good === null
      ? "text-muted-foreground"
      : good
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-red-600 dark:text-red-400";
  const Icon =
    change.kind === "up"
      ? ArrowUpRight
      : change.kind === "down"
        ? ArrowDownRight
        : Minus;
  const text =
    change.kind === "new"
      ? t("new")
      : change.kind === "flat"
        ? t("flat")
        : `${f.integer(change.pct)}%`;
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs", tone)}
      data-testid="kpi-change"
      title={label}
    >
      <Icon className="size-3.5" aria-hidden />
      {text}
      <span className="ms-1 text-muted-foreground">{label}</span>
    </span>
  );
}

export interface KpiCardProps {
  label: string;
  /** Formatted value; undefined while it loads. */
  value?: string;
  valueTestId?: string;
  icon?: ReactNode;
  change?: Change;
  goodWhen?: "up" | "down";
  changeLabel?: string;
  /** One plain line saying what the number means, right under its name. */
  hint?: string;
  /** A line under the value (an average, a margin, ...). */
  sub?: string;
  /** The value is a name, not a number: smaller type, may wrap. */
  compactValue?: boolean;
  spark?: number[];
  testId?: string;
}

/** One headline number: what it is, how much, how it moved, and (optionally) its trend. */
export function KpiCard({
  label,
  value,
  valueTestId,
  icon,
  change,
  goodWhen,
  changeLabel = "",
  hint,
  compactValue,
  sub,
  spark,
  testId,
}: KpiCardProps) {
  return (
    <Card size="sm" data-testid={testId}>
      <CardContent className="flex flex-col gap-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
        </span>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
        {value === undefined ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <span
            className={cn(
              "font-semibold tabular-nums",
              compactValue
                ? "break-words text-lg leading-snug"
                : "text-xl md:text-2xl",
            )}
            data-testid={valueTestId}
          >
            {value}
          </span>
        )}
        {sub ? (
          <span className="text-xs text-muted-foreground">{sub}</span>
        ) : null}
        {change && value !== undefined ? (
          <ChangeChip change={change} goodWhen={goodWhen} label={changeLabel} />
        ) : null}
        {spark && value !== undefined ? <Sparkline values={spark} /> : null}
      </CardContent>
    </Card>
  );
}
