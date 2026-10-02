"use client";

import { Cloud, CloudOff } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { useDataMode } from "@/data/mode-store";
import {
  appFilesReady,
  checkStorage,
  commitMode,
  type DownloadSize,
  downloadForOffline,
  drainForOnline,
  estimateDownload,
  hasRoomFor,
  SwitchError,
  type SwitchProblem,
} from "@/data/mode-switch";
import { getLocalDb } from "@/db/local/db";
import { getDeviceId } from "@/db/local/meta";
import { useFormat } from "@/i18n/use-format";
import { APP_VERSION } from "@/lib/app-version";
import { createFetchTransport } from "@/sync/transport";

type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "confirmOn"; size: DownloadSize }
  | { kind: "downloading"; done: number; total: number }
  | { kind: "confirmOff" }
  | { kind: "sending" }
  | { kind: "error"; problem: SwitchProblem };

const problemOf = (error: unknown): SwitchProblem =>
  error instanceof SwitchError ? error.problem : "FAILED";

/**
 * The "Work offline" switch. Off (the default): the app asks the server for what it shows, always
 * up to date, and needs internet. On: this device downloads the whole shop first and then works
 * with no internet at all. Only the owner and managers can change it; everyone sees it.
 */
export function WorkOfflineSwitch({
  variant,
}: {
  variant: "sidebar" | "card";
}) {
  const t = useTranslations("mode");
  const f = useFormat();
  const mode = useDataMode();
  const { role } = useProfile();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const canSwitch = can(role, "mode.switch");
  const offline = mode === "offline";
  const working =
    phase.kind === "checking" ||
    phase.kind === "downloading" ||
    phase.kind === "sending";

  async function askToTurnOn() {
    if (!navigator.onLine)
      return setPhase({ kind: "error", problem: "NO_INTERNET" });
    setPhase({ kind: "checking" });
    try {
      const size = await estimateDownload(getLocalDb());
      const { free } = await checkStorage();
      if (!hasRoomFor(size.changes, free))
        return setPhase({ kind: "error", problem: "NO_SPACE" });
      setPhase({ kind: "confirmOn", size });
    } catch (error) {
      setPhase({ kind: "error", problem: problemOf(error) });
    }
  }

  async function turnOn(size: DownloadSize) {
    const db = getLocalDb();
    setPhase({
      kind: "downloading",
      done: 0,
      total: Math.max(1, size.changes),
    });
    try {
      await downloadForOffline(
        db,
        createFetchTransport(),
        size,
        (done, total) => setPhase({ kind: "downloading", done, total }),
      );
      // The app's own files must be saved too, or the first offline start would find a blank page.
      await appFilesReady();
      void navigator.storage?.persist?.();
      await commitMode(db, "offline");
      location.reload();
    } catch (error) {
      setPhase({ kind: "error", problem: problemOf(error) });
    }
  }

  async function turnOff() {
    const db = getLocalDb();
    setPhase({ kind: "sending" });
    try {
      await drainForOnline(db, createFetchTransport(), {
        deviceId: await getDeviceId(db),
        appVersion: APP_VERSION,
      });
      await commitMode(db, "online");
      location.reload();
    } catch (error) {
      setPhase({ kind: "error", problem: problemOf(error) });
    }
  }

  const onChange = (checked: boolean) =>
    checked ? void askToTurnOn() : setPhase({ kind: "confirmOff" });

  const control =
    variant === "card" ? (
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("label")}</p>
          <p className="text-xs text-muted-foreground">
            {offline ? t("hintOn") : t("hintOff")}
          </p>
          {canSwitch ? null : (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("ownerOnly")}
            </p>
          )}
        </div>
        <Switch
          checked={offline}
          onCheckedChange={onChange}
          disabled={!canSwitch || working || mode === null}
          aria-label={t("label")}
          data-testid="work-offline-switch"
        />
      </div>
    ) : (
      <SidebarMenuItem>
        <SidebarMenuButton
          asChild
          tooltip={`${t("label")}: ${offline ? t("on") : t("off")}`}
        >
          <div
            className="flex w-full items-center gap-2"
            data-testid="sidebar-mode"
          >
            {offline ? <CloudOff aria-hidden /> : <Cloud aria-hidden />}
            <span className="min-w-0 flex-1 truncate">{t("label")}</span>
            <Switch
              size="sm"
              checked={offline}
              onCheckedChange={onChange}
              disabled={!canSwitch || working || mode === null}
              aria-label={t("label")}
              data-testid="work-offline-switch"
              className="group-data-[collapsible=icon]:hidden"
            />
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );

  const close = () => setPhase({ kind: "idle" });
  const open = phase.kind !== "idle";

  return (
    <>
      {control}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          // While something is running there is nothing to dismiss.
          if (!next && !working) close();
        }}
      >
        <AlertDialogContent>
          {phase.kind === "confirmOn" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("onTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("onBody", {
                    count: phase.size.changes,
                    n: f.integer(phase.size.changes),
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void turnOn(phase.size);
                  }}
                  data-testid="mode-confirm-on"
                >
                  {t("start")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}

          {phase.kind === "checking" ? (
            <AlertDialogHeader>
              <AlertDialogTitle>{t("checking")}</AlertDialogTitle>
              <AlertDialogDescription>{t("wait")}</AlertDialogDescription>
            </AlertDialogHeader>
          ) : null}

          {phase.kind === "downloading" ? (
            <AlertDialogHeader>
              <AlertDialogTitle>{t("preparing")}</AlertDialogTitle>
              <AlertDialogDescription>{t("keepOpen")}</AlertDialogDescription>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={phase.total}
                aria-valuenow={phase.done}
                className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
                data-testid="mode-progress"
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.round((phase.done / phase.total) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("downloading", {
                  done: f.integer(phase.done),
                  total: f.integer(phase.total),
                })}
              </p>
            </AlertDialogHeader>
          ) : null}

          {phase.kind === "confirmOff" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("offTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("offBody")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    void turnOff();
                  }}
                  data-testid="mode-confirm-off"
                >
                  {t("offConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}

          {phase.kind === "sending" ? (
            <AlertDialogHeader>
              <AlertDialogTitle>{t("sending")}</AlertDialogTitle>
              <AlertDialogDescription>{t("wait")}</AlertDialogDescription>
            </AlertDialogHeader>
          ) : null}

          {phase.kind === "error" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("errorTitle")}</AlertDialogTitle>
                <AlertDialogDescription data-testid="mode-error">
                  {t(`problem.${phase.problem}`)}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {phase.problem === "UNSENT" ? (
                  <Button asChild variant="outline">
                    <Link href="/sync" onClick={close}>
                      {t("openSync")}
                    </Link>
                  </Button>
                ) : null}
                <AlertDialogCancel>{t("close")}</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
