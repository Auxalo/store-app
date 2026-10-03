"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { usePreferences } from "@/stores/preferences";

/** Switches between English and বাংলা instantly; shows the language you would switch to. */
export function LanguageSwitch() {
  const t = useTranslations();
  const locale = usePreferences((s) => s.locale);
  const setLocale = usePreferences((s) => s.setLocale);
  const other = locale === "bn" ? "en" : "bn";

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setLocale(other)}
      aria-label={t("common.language")}
      lang={other}
    >
      <Languages aria-hidden />
      {/* Only the icon on a phone, so the page title has room (the button keeps its name). */}
      <span className="max-sm:sr-only">{t(`language.${other}`)}</span>
    </Button>
  );
}
