"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { findNavItem } from "@/config/nav";
import { useFormat } from "@/i18n/use-format";

/** Stand-in for screens built in later phases. Removed per screen as each one lands. */
export function PagePlaceholder() {
  const t = useTranslations();
  const f = useFormat();
  const item = findNavItem(usePathname());
  if (!item) return null;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <item.icon className="size-7 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="text-xl font-semibold">{t(`nav.${item.key}`)}</h2>
      <p className="text-sm text-muted-foreground">
        {t("placeholder.comingIn", { phase: f.integer(item.phase) })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("placeholder.foundation")}
      </p>
    </div>
  );
}
