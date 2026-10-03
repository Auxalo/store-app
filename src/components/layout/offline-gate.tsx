"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDataMode } from "@/data/mode-store";
import { fetchHead } from "@/data/online";
import { getLocalDb } from "@/db/local/db";
import { getMeta } from "@/db/local/meta";
import { useFormat } from "@/i18n/use-format";
import { useSyncStore } from "@/sync/store";

/**
 * In offline mode the app is used only once the shop's data is on the device, so no screen ever
 * shows "nothing here" for something that is simply not downloaded yet. A device that has been
 * ready before is ready at once (it starts from what it has and catches up in the background).
 */
export function OfflineGate({ children }: { children: ReactNode }) {
  const t = useTranslations("mode.gate");
  const f = useFormat();
  const mode = useDataMode();
  const ready = useSyncStore((s) => s.initialSyncDone);
  const pulledTo = useSyncStore((s) => s.pulledTo);
  // Only when the device is KNOWN to have no download yet. While that is still being read from
  // the device (a moment after every start), the app is shown, not a "preparing" screen.
  const downloaded = useLiveQuery(
    async () => ((await getMeta(getLocalDb(), "cursor")) ?? null) !== null,
    [],
  );
  const waiting = mode === "offline" && downloaded === false && !ready;

  const [head, setHead] = useState<number>();
  useEffect(() => {
    if (!waiting) return;
    void fetchHead()
      .then(setHead)
      .catch(() => undefined);
  }, [waiting]);

  // After a while with no progress, say what to do instead of spinning forever.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, [waiting]);

  if (!waiting) return children;
  const percent =
    head && pulledTo ? Math.min(100, Math.round((pulledTo / head) * 100)) : 0;
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center"
      data-testid="offline-gate"
    >
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="max-w-xs text-sm text-muted-foreground">{t("body")}</p>
      {slow && !pulledTo ? (
        <>
          <p className="max-w-xs text-sm text-destructive" role="status">
            {t("slow")}
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t("retry")}
          </Button>
        </>
      ) : null}
      {head ? (
        <div className="w-full max-w-xs">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {f.integer(percent)}%
          </p>
        </div>
      ) : null}
    </div>
  );
}
