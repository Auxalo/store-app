"use client";

import { Ban, Pencil, Smartphone } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFormat } from "@/i18n/use-format";
import { api } from "./api";

interface DeviceInfo {
  id: string;
  code: string;
  name: string;
  lastSeenAt: string;
  isThisDevice: boolean;
  revokedAt: string | null;
}

/** Every phone and computer using the store; the owner can rename or cut one off. */
export function DevicesScreen() {
  const t = useTranslations();
  const f = useFormat();
  const { role } = useProfile();
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [renaming, setRenaming] = useState<DeviceInfo | null>(null);
  const [name, setName] = useState("");
  const [revoking, setRevoking] = useState<DeviceInfo | null>(null);

  const load = useCallback(async () => {
    const result = await api<{ devices: DeviceInfo[] }>("/api/devices");
    if (result.ok && result.data) {
      setDevices(result.data.devices);
      setOffline(false);
    } else setOffline(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can(role, "settings.manage"))
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("settings.noAccess")}
      </p>
    );

  async function saveName() {
    if (!renaming || name.trim().length < 1) return;
    const result = await api(`/api/devices/${renaming.id}`, {
      method: "PATCH",
      body: { name: name.trim() },
    });
    if (!result.ok) return void toast.error(t("devices.needsInternet"));
    setRenaming(null);
    await load();
  }

  async function revoke() {
    if (!revoking) return;
    const result = await api(`/api/devices/${revoking.id}/revoke`, {
      method: "POST",
    });
    setRevoking(null);
    if (!result.ok) return void toast.error(t("devices.needsInternet"));
    await load();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      {offline ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {t("devices.needsInternet")}
        </p>
      ) : null}
      {devices === null && !offline ? (
        <Skeleton className="h-16 w-full" />
      ) : null}
      {devices?.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t("devices.empty")}
        </p>
      ) : null}
      <ul className="grid gap-2" data-testid="device-list">
        {devices?.map((d) => (
          <li
            key={d.id}
            className="flex items-center gap-3 rounded-xl border bg-card p-3"
            data-testid="device-row"
          >
            <Smartphone
              className="size-5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <span className="truncate">{d.name}</span>
                {d.isThisDevice ? (
                  <Badge variant="secondary">{t("devices.thisDevice")}</Badge>
                ) : null}
                {d.revokedAt ? (
                  <Badge variant="destructive">{t("devices.revoked")}</Badge>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("devices.code")} {d.code} · {t("devices.lastSeen")}{" "}
                {f.dateTime(new Date(d.lastSeenAt))}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("devices.rename")}
              onClick={() => {
                setRenaming(d);
                setName(d.name);
              }}
            >
              <Pencil aria-hidden />
            </Button>
            {!d.revokedAt ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("devices.revoke")}
                onClick={() => setRevoking(d)}
                data-testid="revoke-device"
              >
                <Ban aria-hidden />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <ResponsiveDialog
        open={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        title={t("devices.rename")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void saveName();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="device-name">{t("devices.name")}</FieldLabel>
              <Input
                id="device-name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field>
            <Button type="submit">{t("common.save")}</Button>
          </FieldGroup>
        </form>
      </ResponsiveDialog>

      <AlertDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("devices.revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("devices.revokeBody")}
              {revoking?.isThisDevice ? ` ${t("devices.revokeSelf")}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void revoke()}
              data-testid="confirm-revoke"
            >
              {t("devices.revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
