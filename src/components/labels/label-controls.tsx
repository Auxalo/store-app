"use client";

import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLabelPaper } from "@/hooks/use-labels";
import { useFormat } from "@/i18n/use-format";
import {
  clampSize,
  LABEL_SIZES,
  type LabelSize,
  MAX_LABEL_MM,
  MIN_LABEL_MM,
} from "@/lib/labels/label-layout";
import {
  fitsRoll,
  isRoll,
  LABEL_PAPERS,
  type LabelPaper,
  rollLengthMm,
  rollPrintableMm,
  sheetGrid,
  sheetPages,
} from "@/lib/labels/label-sheet";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";

const same = (a: LabelSize, b: LabelSize) => a.w === b.w && a.h === b.h;

const chip = (on: boolean) =>
  cn(
    "h-auto rounded-full px-3 py-1.5 text-sm",
    on
      ? "border-primary bg-primary/10 text-primary hover:bg-primary/15"
      : "text-muted-foreground",
  );

/** A tiny picture of the A4 sheet: every place a label can go, the ones this print fills in green. */
function SheetMap({
  cols,
  rows,
  filled,
  label,
}: {
  cols: number;
  rows: number;
  filled: number;
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className="grid shrink-0 gap-px rounded-sm bg-white p-[3px] shadow-sm ring-1 ring-black/15"
      style={{
        width: 46,
        aspectRatio: "210 / 297",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
      data-testid="label-sheet-map"
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: the places on the sheet never move
          key={i}
          className={cn(
            "rounded-[1px]",
            i < filled ? "bg-primary" : "bg-neutral-200",
          )}
        />
      ))}
    </div>
  );
}

/**
 * What the labels are printed on (kept on this device): a sticker roll, the receipt printer roll
 * or A4 paper, and under it what to expect for `total` labels: how many fit on a page and how many
 * pages, or how much of the roll it takes. A label too wide for the roll is said in red.
 */
export function LabelPaperPicker({ total }: { total: number }) {
  const t = useTranslations("labels");
  const f = useFormat();
  const paper = useLabelPaper();
  const setPaper = usePreferences((s) => s.setLabelPaper);
  const size = clampSize(usePreferences((s) => s.labelSize));
  const names: Record<LabelPaper, string> = {
    label: t("paperLabel"),
    "80mm": t("paper80mm"),
    "58mm": t("paper58mm"),
    a4: t("paperA4"),
  };
  const count = Math.max(1, total);

  let hint: ReactNode;
  if (paper === "a4") {
    const grid = sheetGrid(size);
    const pages = sheetPages(count, grid);
    hint = (
      <div className="flex items-center gap-3">
        <SheetMap
          cols={grid.cols}
          rows={grid.rows}
          filled={Math.min(count, grid.perPage)}
          label={t("sheetAlt")}
        />
        <p>
          {t("hintA4", {
            per: f.integer(grid.perPage),
            pc: pages,
            p: f.integer(pages),
          })}
        </p>
      </div>
    );
  } else if (isRoll(paper)) {
    if (fitsRoll(size, paper)) {
      const cm = Math.round(rollLengthMm(count, size) / 10);
      const len =
        cm < 100
          ? t("lenCm", { n: f.integer(cm) })
          : t("lenM", { n: f.number(Math.round(cm / 10) / 10) });
      hint = <p>{t("hintRoll", { len })}</p>;
    } else
      hint = (
        <p
          role="alert"
          className="font-medium text-destructive"
          data-testid="label-paper-wide"
        >
          {t("paperTooWide", { w: size.w, max: rollPrintableMm(paper) })}
        </p>
      );
  } else hint = <p>{t("hintLabel")}</p>;

  return (
    <div className="flex flex-col gap-2" data-testid="label-paper">
      <p className="text-sm font-medium">{t("paper")}</p>
      <div className="flex flex-wrap gap-2">
        {LABEL_PAPERS.map((p) => (
          <Button
            key={p}
            type="button"
            variant="outline"
            aria-pressed={paper === p}
            className={chip(paper === p)}
            onClick={() => setPaper(p)}
            data-testid={`label-paper-${p}`}
          >
            {names[p]}
          </Button>
        ))}
      </div>
      <div
        className="text-xs text-muted-foreground"
        data-testid="label-paper-hint"
      >
        {hint}
      </div>
    </div>
  );
}

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
