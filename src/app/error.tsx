"use client";

import { RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/report-client-error";

/** What a person sees when a screen crashes: a plain message and a way to try again. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorPage");
  useEffect(() => {
    reportClientError(error, "boundary");
  }, [error]);
  return (
    <div
      className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 p-6 text-center"
      data-testid="error-page"
    >
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t("body")}</p>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RotateCw aria-hidden />
          {t("retry")}
        </Button>
        <Button variant="outline" onClick={() => location.assign("/dashboard")}>
          {t("home")}
        </Button>
      </div>
    </div>
  );
}
