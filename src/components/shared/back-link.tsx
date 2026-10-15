"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** "Back to the list" at the top of a detail page (the bottom bar alone does not say where you came from). */
export function BackLink({ href, label }: { href: string; label?: string }) {
  const t = useTranslations("common");
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      data-testid="back-link"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
      {label ?? t("back")}
    </Link>
  );
}
