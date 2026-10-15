"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { presetRange } from "@/reports/ranges";

/** The quick ranges of a list. "custom" is the dates typed in the Filters panel (no chip is lit). */
export type Period = "today" | "days7" | "days30" | "all" | "custom";

const CHIPS = ["today", "days7", "days30", "all"] as const;

/**
 * The days a period covers, in the shop's time zone. "all" and "custom" give none: custom dates
 * come from the Filters panel.
 */
export function periodDates(
  period: Period,
  timeZone: string,
): { from?: string; to?: string } {
  if (period === "today" || period === "days7" || period === "days30")
    return presetRange(period, timeZone);
  return {};
}

/**
 * Today / 7 days / 30 days / All, shared by the sales, purchases and payments lists. Drawn as pills
 * so they read as "how far back" and not as another set of tabs.
 */
export function PeriodChips({
  value,
  onChange,
}: {
  value: Period;
  onChange: (period: Period) => void;
}) {
  const t = useTranslations("list");
  const label = {
    today: t("periodToday"),
    days7: t("periodDays7"),
    days30: t("periodDays30"),
    all: t("periodAll"),
  } as const;
  return (
    <div
      role="tablist"
      aria-label={t("periodLabel")}
      className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
      data-testid="period-chips"
    >
      {CHIPS.map((p) => {
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={active}
            data-state={active ? "active" : "inactive"}
            data-testid={`period-${p}`}
            onClick={() => onChange(p)}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors [@media(pointer:coarse)]:h-9",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label[p]}
          </button>
        );
      })}
    </div>
  );
}
