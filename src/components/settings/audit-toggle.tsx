"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useSetting } from "@/hooks/use-setting";
import { AUDIT_SETTING } from "@/lib/constants";

/**
 * Turns the audit log on or off for the whole store. It is off by default because it uses a lot of
 * database storage; turning it on asks for confirmation and explains that rows are kept for 7 days.
 */
export function AuditToggleCard() {
  const t = useTranslations("settings");
  const audit = useSetting<boolean>(AUDIT_SETTING, false);
  const [confirming, setConfirming] = useState(false);

  async function set(next: boolean) {
    await audit.set(next);
    toast.success(next ? t("auditOn") : t("auditOff"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("auditTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="text-sm">
            <p id="audit-toggle-label" className="font-medium">
              {t("auditToggle")}
            </p>
            <p className="text-muted-foreground">{t("auditToggleHint")}</p>
          </div>
          <Switch
            checked={audit.value}
            onCheckedChange={(next) =>
              next ? setConfirming(true) : void set(false)
            }
            aria-labelledby="audit-toggle-label"
            data-testid="audit-toggle"
          />
        </div>
      </CardContent>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auditConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("auditConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("auditConfirmCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void set(true)}
              data-testid="audit-confirm"
            >
              {t("auditConfirmOk")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
