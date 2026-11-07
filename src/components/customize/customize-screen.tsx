"use client";

import { ChevronRight, Coins, type LucideIcon, Ruler } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";

interface Card {
  id: string;
  href: string;
  icon: LucideIcon;
  /** Keys in the "customize" namespace. */
  title: string;
  body: string;
}

/** Each card opens one setting. More are added here as the app gets more to customize. */
const CARDS: readonly Card[] = [
  {
    id: "units",
    href: "/customize/units",
    icon: Ruler,
    title: "unitsCard",
    body: "unitsCardBody",
  },
  {
    id: "currency",
    href: "/customize/currency",
    icon: Coins,
    title: "currencyCard",
    body: "currencyCardBody",
  },
  {
    id: "payments",
    href: "/customize/payments",
    icon: Coins,
    title: "paymentsCard",
    body: "paymentsCardBody",
  },
];

/** Where a shop makes the app its own. */
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
        {CARDS.map((card) => (
          <li key={card.id}>
            <Link
              href={card.href}
              className="flex items-center gap-3 rounded-xl border bg-card p-4 hover:bg-muted/40"
              data-testid={`card-${card.id}`}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <card.icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {t(card.title as never)}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {t(card.body as never)}
                </span>
              </span>
              <ChevronRight
                className="size-5 shrink-0 text-muted-foreground rtl:rotate-180"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
