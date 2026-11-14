"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useFormat } from "@/i18n/use-format";
import {
  clampSize,
  LABEL_SIZES,
  type LabelSize,
  MAX_LABEL_MM,
  MIN_LABEL_MM,
} from "@/lib/labels/label-layout";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";

const same = (a: LabelSize, b: LabelSize) => a.w === b.w && a.h === b.h;

/** The sticker size (kept on this device): the usual ones as buttons, or a size of one's own. */
export function LabelSizePicker() {
  const t = useTranslations("labels");
  const f = useFormat();
  const size = usePreferences((s) => s.labelSize);
  const setSize = usePreferences((s) => s.setLabelSize);
  const preset = LABEL_SIZES.some((s) => same(s, size));
  const [custom, setCustom] = useState(!preset);
  const [w, setW] = useState(String(size.w));
  const [h, setH] = useState(String(size.h));
  const id = useId();

  function commit(nextW: string, nextH: string) {
    const next = clampSize({ w: Number(nextW), h: Number(nextH) });
    setSize(next);
    setW(String(next.w));
    setH(String(next.h));
  }

  const chip = (on: boolean) =>
    cn(
      "h-auto rounded-full px-3 py-1.5 text-sm",
      on
        ? "border-primary bg-primary/10 text-primary hover:bg-primary/15"
        : "text-muted-foreground",
    );

  return (
    <div className="flex flex-col gap-2" data-testid="label-size">
      <p className="text-sm font-medium">{t("size")}</p>
      <div className="flex flex-wrap gap-2">
        {LABEL_SIZES.map((s) => (
          <Button
            key={`${s.w}x${s.h}`}
            type="button"
            variant="outline"
            aria-pressed={!custom && same(s, size)}
            className={chip(!custom && same(s, size))}
            onClick={() => {
              setCustom(false);
              setSize(s);
              setW(String(s.w));
              setH(String(s.h));
            }}
            data-testid={`label-size-${s.w}x${s.h}`}
          >
            {f.integer(s.w)} × {f.integer(s.h)}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          aria-pressed={custom}
          className={chip(custom)}
          onClick={() => setCustom(true)}
          data-testid="label-size-custom"
        >
          {t("custom")}
        </Button>
      </div>
      {custom ? (
        <div className="grid grid-cols-2 gap-3">
          <label htmlFor={`${id}-w`} className="flex flex-col gap-1 text-xs">
            {t("width")}
            <Input
              id={`${id}-w`}
              type="number"
              inputMode="numeric"
              min={MIN_LABEL_MM}
              max={MAX_LABEL_MM}
              value={w}
              onChange={(e) => setW(e.target.value)}
              onBlur={() => commit(w, h)}
              data-testid="label-width"
            />
          </label>
          <label htmlFor={`${id}-h`} className="flex flex-col gap-1 text-xs">
            {t("height")}
            <Input
              id={`${id}-h`}
              type="number"
              inputMode="numeric"
              min={MIN_LABEL_MM}
              max={MAX_LABEL_MM}
              value={h}
              onChange={(e) => setH(e.target.value)}
              onBlur={() => commit(w, h)}
              data-testid="label-height"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** "Show the price on the label" (kept on this device). */
export function LabelPriceSwitch() {
  const t = useTranslations("labels");
  const show = usePreferences((s) => s.labelShowPrice);
  const set = usePreferences((s) => s.setLabelShowPrice);
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm font-medium">
        {t("showPrice")}
      </label>
      <Switch
        id={id}
        checked={show}
        onCheckedChange={set}
        data-testid="label-show-price"
      />
    </div>
  );
}

/** − 3 + : how many labels. Big buttons, so it is easy to tap. */
export function CopiesStepper({
  value,
  onChange,
  max = 999,
  label,
  size = "default",
}: {
  value: number;
  onChange: (n: number) => void;
  max?: number;
  label: string;
  size?: "default" | "small";
}) {
  const f = useFormat();
  const small = size === "small";
  const set = (n: number) =>
    onChange(Math.max(1, Math.min(max, Math.round(n) || 1)));
  return (
    <fieldset
      className="m-0 flex min-w-0 items-center gap-1 border-0 p-0"
      aria-label={label}
      data-testid="copies"
    >
      <Button
        type="button"
        variant="outline"
        size={small ? "icon-sm" : "icon-lg"}
        aria-label="−"
        disabled={value <= 1}
        onClick={() => set(value - 1)}
        data-testid="copies-minus"
      >
        <Minus aria-hidden />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        onFocus={(e) => e.currentTarget.select()}
        aria-label={label}
        className={cn(
          "text-center font-semibold",
          small ? "w-14" : "w-20 text-lg",
        )}
        data-testid="copies-input"
      />
      <Button
        type="button"
        variant="outline"
        size={small ? "icon-sm" : "icon-lg"}
        aria-label="+"
        disabled={value >= max}
        onClick={() => set(value + 1)}
        data-testid="copies-plus"
      >
        <Plus aria-hidden />
      </Button>
      {/* the number as the shop reads it (Bangla digits when chosen) */}
      <span className="sr-only">{f.integer(value)}</span>
    </fieldset>
  );
}
