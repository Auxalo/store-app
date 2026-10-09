"use client";

import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { signOut } from "@/auth/use-auth";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { getLocalDb } from "@/db/local/db";
import { unsentCount } from "@/db/local/wipe";
import { useFormat } from "@/i18n/use-format";
import { syncNow } from "@/sync/manager";

/** Signs out, then opens the sign-in page fresh (nothing of this session stays in memory). */
async function finish(keepData = false): Promise<boolean> {
  if (!(await signOut({ keepData }))) return false;
  window.location.replace("/login");
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Signing out takes the shop's data off this device. Work that has not reached the server would
 * go with it, so first: send it. Only if the person insists is it deleted (twice asked).
 * Returns `request` (call it from any sign-out button) and the dialog to render.
 */
export function useSignOut(): { request: () => void; dialog: ReactNode } {
  const t = useTranslations("account");
  const tc = useTranslations("common");
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const unsent =
    useLiveQuery(() => (open ? unsentCount(getLocalDb()) : 0), [open]) ?? 0;

  const failed = () => toast.error(t("signOutFailed"));

  async function request() {
    if ((await unsentCount(getLocalDb())) === 0) {
      if (!(await finish())) failed();
      return;
    }
    setStuck(false);
    setDiscarding(false);
    setOpen(true);
  }

  async function sendThenSignOut() {
    setSending(true);
    setStuck(false);
    try {
      await syncNow();
      // The queue empties as the server answers; give it a little time.
      for (let i = 0; i < 40; i++) {
        if ((await unsentCount(getLocalDb())) === 0) {
          if (!(await finish())) failed();
          return;
        }
        await sleep(500);
      }
      setStuck(true);
    } finally {
      setSending(false);
    }
  }

  const dialog = (
    <AlertDialog open={open} onOpenChange={(o) => !sending && setOpen(o)}>
      <AlertDialogContent data-testid="sign-out-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("signOutPendingTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("signOutPendingBody", { count: unsent, n: f.integer(unsent) })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {stuck ? (
          <p className="text-sm text-destructive" role="alert">
            {t("signOutStillPending", { n: f.integer(unsent) })}{" "}
            <Link href="/sync" className="underline">
              {t("signOutOpenSync")}
            </Link>
          </p>
        ) : null}
        {discarding ? (
          <p className="text-sm text-destructive" role="alert">
            {t("signOutDiscardWarning", { n: f.integer(unsent) })}
          </p>
        ) : null}
        <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={() => void sendThenSignOut()}
            disabled={sending}
            data-testid="sign-out-send"
          >
            {sending ? t("signOutSending") : t("signOutSend")}
          </Button>
          {discarding ? (
            <Button
              variant="destructive"
              disabled={sending}
              onClick={() => void finish().then((done) => !done && failed())}
              data-testid="sign-out-discard-confirm"
            >
              {t("signOutDiscardConfirm", { n: f.integer(unsent) })}
            </Button>
          ) : (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={sending}
              onClick={() => setDiscarding(true)}
              data-testid="sign-out-discard"
            >
              {t("signOutDiscard")}
            </Button>
          )}
          <AlertDialogCancel disabled={sending}>
            {tc("cancel")}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { request: () => void request(), dialog };
}

/** For a device that holds another shop's unsent work: sign out WITHOUT deleting it. */
export async function signOutKeepingData(): Promise<boolean> {
  return finish(true);
}
