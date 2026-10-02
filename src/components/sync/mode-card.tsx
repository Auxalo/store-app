"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { CheckCircle2, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDataMode } from "@/data/mode-store";
import {
  appFilesReady,
  checkStorage,
  removeOfflineData,
  SwitchError,
} from "@/data/mode-switch";
import { getLocalDb } from "@/db/local/db";
import { getMeta } from "@/db/local/meta";
import { useSyncStore } from "@/sync/store";
import { WorkOfflineSwitch } from "./work-offline";

function Check({ ok, label }: { ok: boolean; label: string }) {
  const t = useTranslations("mode.readiness");
  const Icon = ok ? CheckCircle2 : Circle;
  return (
    <li className="flex items-center gap-2 text-sm">
      <Icon
        className={`size-4 ${ok ? "text-emerald-600" : "text-muted-foreground"}`}
        aria-hidden
      />
      <span className="flex-1">{label}</span>
      <span className="text-xs text-muted-foreground">
        {ok ? t("ready") : t("notReady")}
      </span>
    </li>
  );
}

const isIphone = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  !(navigator as Navigator & { standalone?: boolean }).standalone;

/** The Work offline switch, and what it needs: is the device ready to work with no internet? */
export function ModeCard() {
  const t = useTranslations("mode");
  const mode = useDataMode();
  const { role } = useProfile();
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);
  const hasData = useLiveQuery(
    async () => (await getMeta(getLocalDb(), "cursor")) !== undefined,
    [],
  );

  const [files, setFiles] = useState(false);
  const [persisted, setPersisted] = useState(false);
  const [phone, setPhone] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    void appFilesReady(3_000).then(setFiles);
    void checkStorage().then((s) => setPersisted(s.persisted));
    setPhone(isIphone());
  }, []);

  async function remove() {
    setRemoving(false);
    try {
      await removeOfflineData(getLocalDb());
      toast.success(t("remove.done"));
    } catch (error) {
      toast.error(
        error instanceof SwitchError && error.problem === "UNSENT"
          ? t("remove.blocked")
          : t("problem.FAILED"),
      );
    }
  }

  return (
    <Card data-testid="mode-card">
      <CardHeader>
        <CardTitle className="text-base">{t("label")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <WorkOfflineSwitch variant="card" />

        {mode === "offline" ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-sm font-medium">{t("readiness.title")}</p>
            <ul className="flex flex-col gap-1.5" data-testid="readiness">
              <Check ok={initialSyncDone} label={t("readiness.data")} />
              <Check ok={files} label={t("readiness.files")} />
              <Check ok={persisted} label={t("readiness.storage")} />
            </ul>
            {!persisted ? (
              <p className="text-xs text-muted-foreground">
                {t("readiness.storageWarn")}
              </p>
            ) : null}
            {phone ? (
              <p className="text-xs text-muted-foreground">
                {t("readiness.iosHint")}
              </p>
            ) : null}
          </div>
        ) : null}

        {mode === "online" && hasData && can(role, "mode.switch") ? (
          <div className="flex items-start gap-3 border-t pt-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("remove.title")}</p>
              <p className="text-xs text-muted-foreground">
                {t("remove.body")}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRemoving(true)}
              data-testid="remove-offline-data"
            >
              {t("remove.action")}
            </Button>
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("remove.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("remove.confirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void remove()}
              data-testid="remove-confirm"
            >
              {t("remove.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
