"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Store } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useProfile } from "@/auth/use-auth";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";
import { Button } from "@/components/ui/button";
import { getLocalDb } from "@/db/local/db";
import { getMeta } from "@/db/local/meta";
import { useSyncStore } from "@/sync/store";
import { signOutKeepingData } from "./sign-out";

/**
 * Shows the app only when the data on this device belongs to the shop that is signed in. Another
 * shop's data is cleared before anything is shown (the sync manager does it); if that shop still
 * has work that never reached the server, nothing is shown at all, and the screen says whose
 * account must sign in to send it.
 */
export function StoreGate({ children }: { children: ReactNode }) {
  const { storeId } = useProfile();
  const t = useTranslations("sync");
  const ta = useTranslations("account");
  const stored = useLiveQuery(
    async () => (await getMeta(getLocalDb(), "storeId")) ?? null,
    [],
  );
  const mismatch = useSyncStore((s) => s.problem === "storeMismatch");

  if (mismatch)
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
        data-testid="store-mismatch"
      >
        <Store className="size-10 text-muted-foreground" aria-hidden />
        <p className="max-w-sm text-sm">{t("problem.storeMismatch")}</p>
        <Button
          variant="outline"
          onClick={() =>
            void signOutKeepingData().then(
              (done) => !done && toast.error(ta("signOutFailed")),
            )
          }
          data-testid="store-mismatch-sign-out"
        >
          {ta("signOutKeep")}
        </Button>
      </div>
    );
  // Still reading, or another shop's data is being cleared: show nothing of it.
  if (stored === undefined || (stored !== null && stored !== storeId))
    return <FullScreenLoader />;
  return children;
}
