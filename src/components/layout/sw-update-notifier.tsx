"use client";

import { useSerwist } from "@serwist/turbopack/react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Offers a refresh when a new service worker is waiting. The user decides when to apply it,
 * so an update never reloads the page in the middle of a sale.
 */
export function SwUpdateNotifier() {
  const t = useTranslations("pwa");
  const { serwist } = useSerwist();

  useEffect(() => {
    if (!serwist) return;
    const onWaiting = () => {
      toast(t("updateAvailable"), {
        id: "sw-update",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: t("update"),
          onClick: () => {
            serwist.addEventListener("controlling", () =>
              window.location.reload(),
            );
            serwist.messageSkipWaiting();
          },
        },
      });
    };
    serwist.addEventListener("waiting", onWaiting);
    return () => serwist.removeEventListener("waiting", onWaiting);
  }, [serwist, t]);

  return null;
}
