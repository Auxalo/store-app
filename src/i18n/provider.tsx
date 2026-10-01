"use client";

import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { usePreferences } from "@/stores/preferences";
import bn from "./messages/bn.json";
import en from "./messages/en.json";

const messages = { en, bn } as const;

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = usePreferences((s) => s.locale);
  const timeZone = usePreferences((s) => s.timeZone);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      timeZone={timeZone}
    >
      {children}
    </NextIntlClientProvider>
  );
}
