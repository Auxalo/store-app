"use client";

import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";

export interface Bar {
  day: string;
  value: number;
}

interface BarChartProps {
  bars: Bar[];
  label: string;
  className?: string;
}

/** A light bar chart in plain CSS: no chart library to download, and it stays smooth on a cheap phone. */
export function BarChart({ bars, label, className }: BarChartProps) {
  const f = useFormat();
  const max = Math.max(1, ...bars.map((b) => b.value));
  const every = bars.length > 14 ? 5 : 1;

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("flex h-36 items-end gap-0.5", className)}
      data-testid="bar-chart"
    >
      {bars.map((bar, i) => (
        <div
          key={bar.day}
          className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1"
          title={`${f.date(`${bar.day}T12:00:00+06:00`)}: ${f.money(bar.value)}`}
        >
          <div
            className={cn(
              "w-full rounded-t-sm",
              bar.value > 0 ? "bg-primary" : "bg-muted",
            )}
            style={{
              height: `${bar.value > 0 ? Math.max(4, (bar.value / max) * 100) : 2}%`,
            }}
          />
          <span className="h-3 truncate text-center text-[10px] leading-3 text-muted-foreground">
            {i % every === 0 || i === bars.length - 1
              ? f.integer(Number(bar.day.slice(8)))
              : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
