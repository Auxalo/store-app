"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { hashPin, needsStrongPin, normalizePin } from "@/auth/pin";
import { refreshStaff } from "@/auth/staff-cache";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getLocalDb } from "@/db/local/db";
import { useActiveUser } from "@/stores/active-user";

interface PinDialogProps {
  userId: string;
  userName: string;
  /** "Set my PIN" vs "Set PIN for <name>". */
  self?: boolean;
  /** Their role: an owner or manager needs a 6-digit PIN. */
  role?: string;
  open: boolean;
  onClose: () => void;
}

/** Sets a PIN. The PIN is hashed here on the device; only the hash is sent to the server. */
export function PinDialog({
  userId,
  userName,
  self,
  role,
  open,
  onClose,
}: PinDialogProps) {
  const t = useTranslations();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const clean = normalizePin(pin, role);
    if (!clean)
      return setError(
        needsStrongPin(role) ? t("pin.invalidStrong") : t("pin.invalid"),
      );
    if (normalizePin(again, role) !== clean) return setError(t("pin.mismatch"));
    if (!navigator.onLine) return setError(t("pin.needsInternet"));

    setSaving(true);
    setError(null);
    try {
      const hashed = await hashPin(clean);
      const response = await fetch(`/api/staff/${userId}/pin`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(hashed),
      });
      if (!response.ok) {
        // A refusal is not a missing connection: say what it is.
        setError(
          response.status === 401
            ? t("pin.needsUnlock")
            : t("common.somethingWrong"),
        );
        return;
      }
      // The person who just set their own PIN can sign their work with it from now on.
      const { activeUserId, asAccount, setProof } = useActiveUser.getState();
      if (self && hashed.proof && (activeUserId === userId || asAccount))
        setProof(userId, hashed.proof);
      await refreshStaff(getLocalDb());
      toast.success(t("pin.saved"));
      setPin("");
      setAgain("");
      onClose();
    } catch {
      setError(t("pin.needsInternet"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={self ? t("pin.setMine") : t("pin.setFor", { name: userName })}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="new-pin">
              {needsStrongPin(role) ? t("pin.newPinStrong") : t("pin.newPin")}
            </FieldLabel>
            <Input
              id="new-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              data-testid="pin-input"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm-pin">{t("pin.confirmPin")}</FieldLabel>
            <Input
              id="confirm-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              data-testid="pin-confirm"
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={saving} data-testid="save-pin">
              {t("common.save")}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </ResponsiveDialog>
  );
}
