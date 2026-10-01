"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { useEventListener } from "usehooks-ts";
import { useConnectivity } from "@/stores/connectivity";

/** Mirrors the browser online/offline events into the connectivity store. */
export function ConnectivityWatcher() {
  const t = useTranslations("status");
  const setOnline = useConnectivity((s) => s.setOnline);

  useEffect(() => {
    setOnline(navigator.onLine);
  }, [setOnline]);

  useEventListener("online", () => setOnline(true));
  useEventListener("offline", () => {
    setOnline(false);
    toast.info(t("offlineHint"), { id: "offline-hint" });
  });

  return null;
}
