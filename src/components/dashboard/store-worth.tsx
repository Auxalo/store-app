"use client";

import { Eye, EyeOff, Gem, Package, Tag, Truck, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { storeWorth } from "@/reports/worth";
import { usePreferences } from "@/stores/preferences";

export interface WorthFigures {
  stockCost: number;
  stockRetail: number;
  customersOwed: number;
  customersAdvance: number;
  suppliersOwed: number;
  suppliersAdvance: number;
}

/**
 * "What is my shop worth?": the stock at cost, plus what customers owe, minus what the shop owes
 * suppliers, with the four numbers it is made of beside it. Amounts can be hidden (one tap) for
 * when someone is standing at the counter.
 */
export function StoreWorth({ figures }: { figures: WorthFigures | undefined }) {
  const t = useTranslations("dashboard");
  const f = useFormat();
  const hidden = usePreferences((s) => s.hideWorth);
  const setHidden = usePreferences((s) => s.setHideWorth);

  const show = (value: number) => (hidden ? "৳ ••••" : f.money(value));
  const worth = figures
    ? storeWorth({
        stockCost: figures.stockCost,
        customersOwed: figures.customersOwed,
        customersAdvance: figures.customersAdvance,
        suppliersOwed: figures.suppliersOwed,
        suppliersAdvance: figures.suppliersAdvance,
      })
    : undefined;

  return (
    <section className="flex flex-col gap-2" data-testid="store-worth">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("worthTitle")}</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setHidden(!hidden)}
          aria-pressed={hidden}
          data-testid="worth-toggle"
        >
          {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {hidden ? t("worthShow") : t("worthHide")}
        </Button>
      </div>

      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 via-emerald-600 to-teal-500 p-4 text-white shadow-md dark:from-emerald-700 dark:via-emerald-700 dark:to-teal-700">
        <div className="flex items-center gap-2 text-sm font-medium text-white/90">
          <Gem className="size-4" aria-hidden />
          {t("worthHero")}
        </div>
        {worth ? (
          <p
            className="mt-1 text-3xl font-bold tabular-nums md:text-4xl"
            data-testid="stat-storeWorth"
          >
            {show(worth.total)}
          </p>
        ) : (
          <Skeleton className="mt-2 h-9 w-40 bg-white/30" />
        )}
        {worth && figures ? (
          <dl className="mt-2 grid max-w-md gap-0.5 text-sm text-white/90">
            <Part label={t("worthPartStock")} sign="+">
              {show(figures.stockCost)}
            </Part>
            <Part label={t("worthPartCustomers")} sign="+">
              {show(worth.customers)}
            </Part>
            <Part label={t("worthPartSuppliers")} sign="−">
              {show(worth.suppliers)}
            </Part>
          </dl>
        ) : null}
        <p className="mt-2 text-xs text-white/75">{t("worthNote")}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile
          tone="amber"
          icon={<Package className="size-3.5" aria-hidden />}
          label={t("worthStockCost")}
          value={figures && show(figures.stockCost)}
          testId="stat-stockCost"
        />
        <Tile
          tone="sky"
          icon={<Tag className="size-3.5" aria-hidden />}
          label={t("worthStockRetail")}
          value={figures && show(figures.stockRetail)}
          sub={
            figures
              ? t("worthMargin", {
                  value: show(figures.stockRetail - figures.stockCost),
                })
              : undefined
          }
          testId="stat-stockRetail"
        />
        <Tile
          tone="emerald"
          icon={<Users className="size-3.5" aria-hidden />}
          label={t("customerDue")}
          value={figures && show(figures.customersOwed)}
          sub={
            figures && figures.customersAdvance > 0
              ? t("worthAdvances", { value: show(figures.customersAdvance) })
              : undefined
          }
          testId="stat-customerDue"
        />
        <Tile
          tone="rose"
          icon={<Truck className="size-3.5" aria-hidden />}
          label={t("supplierDue")}
          value={figures && show(figures.suppliersOwed)}
          sub={
            figures && figures.suppliersAdvance > 0
              ? t("worthAdvances", { value: show(figures.suppliersAdvance) })
              : undefined
          }
          testId="stat-supplierDue"
        />
      </div>
    </section>
  );
}

function Part({
  label,
  sign,
  children,
}: {
  label: string;
  sign: "+" | "−";
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className="w-3 shrink-0 text-center font-semibold">
          {sign}
        </span>
        <span className="truncate">{label}</span>
      </dt>
      <dd className="shrink-0 font-medium tabular-nums">{children}</dd>
    </div>
  );
}

const TONES = {
  amber:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100",
  sky: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-100",
  rose: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-100",
} as const;

function Tile({
  tone,
  icon,
  label,
  value,
  sub,
  testId,
}: {
  tone: keyof typeof TONES;
  icon: ReactNode;
  label: string;
  value: string | undefined;
  sub?: string;
  testId: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-1 rounded-xl border p-3", TONES[tone])}
    >
      <span className="flex items-start gap-1.5 text-sm font-medium">
        <span className="mt-1 shrink-0">{icon}</span>
        {label}
      </span>
      {value === undefined ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <span
          className="text-xl font-semibold tabular-nums md:text-2xl"
          data-testid={testId}
        >
          {value}
        </span>
      )}
      {sub ? <span className="text-xs opacity-80">{sub}</span> : null}
    </div>
  );
}
