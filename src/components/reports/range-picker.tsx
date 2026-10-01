"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DayRange } from "@/reports/compute";
import { presetRange, type RangePreset } from "@/reports/use-summary";

export interface RangeState {
  preset: RangePreset;
  custom: DayRange;
}

const PRESETS: RangePreset[] = [
  "today",
  "yesterday",
  "days7",
  "days30",
  "thisMonth",
  "custom",
];

/** Resolves the picker's state to the days it covers. */
export function rangeOf(state: RangeState, timeZone: string): DayRange {
  if (state.preset !== "custom") return presetRange(state.preset, timeZone);
  const { from, to } = state.custom;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Quick ranges plus two native date boxes (the phone's own date picker is the easiest one to use). */
export function RangePicker({
  value,
  onChange,
}: {
  value: RangeState;
  onChange: (next: RangeState) => void;
}) {
  const t = useTranslations("reports.range");
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto pb-1">
        <Tabs
          value={value.preset}
          onValueChange={(v) =>
            onChange({ ...value, preset: v as RangePreset })
          }
        >
          <TabsList>
            {PRESETS.map((p) => (
              <TabsTrigger key={p} value={p} className="px-3">
                {t(p)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {value.preset === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          {(["from", "to"] as const).map((edge) => (
            <div
              key={edge}
              className="flex flex-col gap-1 text-xs text-muted-foreground"
            >
              <span>{t(edge)}</span>
              <Input
                type="date"
                aria-label={t(edge)}
                value={value.custom[edge]}
                onChange={(e) =>
                  e.target.value &&
                  onChange({
                    ...value,
                    custom: { ...value.custom, [edge]: e.target.value },
                  })
                }
                data-testid={`range-${edge}`}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
