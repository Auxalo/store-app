"use client";

import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { useSetting } from "@/hooks/use-setting";
import {
  CURRENCIES,
  CURRENCY_SETTING_KEY,
  type CurrencyCode,
  currencyCodeOf,
} from "@/lib/currency";
import { createFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";

/**
 * The currency the shop shows its money in. Only the sign changes: nothing is converted, so ৳100
 * becomes €100. Everyone sees the choice; only the owner can change it.
 */
export function CurrencyScreen() {
  const t = useTranslations("customize.currency");
  const tn = useTranslations("common");
  const tp = useTranslations("products");
  const { role } = useProfile();
  const locale = usePreferences((s) => s.locale);
  const numerals = usePreferences((s) => s.numerals);
  const setting = useSetting<string>(CURRENCY_SETTING_KEY, "BDT");
  const current = currencyCodeOf(setting.value);
  const [saving, setSaving] = useState(false);
  const mayChange = can(role, "settings.manage");

  if (!can(role, "product.edit")) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {tp("noAccess")}
      </p>
    );
  }

  async function choose(code: CurrencyCode) {
    if (!mayChange || code === current) return;
    setSaving(true);
    try {
      await setting.set(code);
      toast.success(t("saved"));
    } catch {
      toast.error(tn("somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link
        href="/customize"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {tn("back")}
      </Link>
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      <ul className="flex flex-col gap-2" data-testid="currency-list">
        {CURRENCIES.map((c) => {
          const sample = createFormat({
            locale,
            numerals,
            currency: c.code,
          }).money(125_000);
          const selected = c.code === current;
          return (
            <li key={c.code}>
              <button
                type="button"
                disabled={!mayChange || saving}
                aria-pressed={selected}
                onClick={() => void choose(c.code)}
                data-testid={`currency-${c.code}`}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-start transition-colors",
                  mayChange && "hover:bg-muted/40",
                  selected && "border-primary bg-primary/5",
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-lg font-semibold">
                  {c.symbol}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {locale === "bn" ? c.nameBn : c.nameEn} ({c.code})
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {t("sample")}: {sample}
                  </span>
                </span>
                {selected ? (
                  <Check className="size-5 shrink-0 text-primary" aria-hidden />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
        {t("notConverted")}
      </p>
      {mayChange ? null : (
        <p className="text-sm text-muted-foreground">{t("ownerOnly")}</p>
      )}
    </div>
  );
}
