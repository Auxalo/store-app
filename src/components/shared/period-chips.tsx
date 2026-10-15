"use client";

import { useTranslations } from "next-intl";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/** Today / 7 days / 30 days / All, shared by the sales, purchases and payments lists. */
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
    <Tabs
      value={value === "custom" ? "" : value}
      onValueChange={(v) => onChange(v as Period)}
    >
      <TabsList data-testid="period-chips">
        {CHIPS.map((p) => (
          <TabsTrigger key={p} value={p} data-testid={`period-${p}`}>
            {label[p]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
