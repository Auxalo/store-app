"use client";

import { ChevronRight, Ruler } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";

/**
 * Where a shop makes the app its own. Each card opens one setting; more will be added here
 * (today: the units things are sold in).
 */
export function CustomizeScreen() {
  const t = useTranslations("customize");
  const tp = useTranslations("products");
  const { role } = useProfile();

  if (!can(role, "product.edit")) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {tp("noAccess")}
      </p>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ul className="flex flex-col gap-2">
        <li>
          <Link
            href="/customize/units"
            className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/40"
            data-testid="card-units"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Ruler className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t("unitsCard")}</span>
              <span className="block text-sm text-muted-foreground">
                {t("unitsCardBody")}
              </span>
            </span>
            <ChevronRight
              className="size-5 shrink-0 text-muted-foreground rtl:rotate-180"
              aria-hidden
            />
          </Link>
        </li>
      </ul>
    </div>
  );
}
