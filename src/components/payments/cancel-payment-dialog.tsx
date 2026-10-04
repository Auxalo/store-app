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
import { Input } from "@/components/ui/input";
import { useCommand } from "@/data/hooks";
import { useFormat } from "@/i18n/use-format";

/**
 * Cancels a payment that was recorded by mistake. It is never deleted: it stays on record, marked
 * cancelled, and the balance goes back to what it was before. A reason is asked for.
 */
export function CancelPaymentDialog({
  payment,
  onClose,
}: {
  payment: { id: string; amount: number } | null;
  onClose: () => void;
}) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const f = useFormat();
  const run = useCommand();
  const [reason, setReason] = useState("");

  async function cancel() {
    if (!payment || !reason.trim()) return;
    try {
      await run("payment.void", { id: payment.id, reason: reason.trim() });
      setReason("");
    } catch {
      toast.error(tc("somethingWrong"));
    }
  }

  return (
    <AlertDialog
      open={payment !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason("");
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("voidTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {payment ? `${f.money(payment.amount)} · ` : ""}
            {t("voidBody")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("voidReason")}
          aria-label={t("voidReason")}
          data-testid="payment-void-reason"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!reason.trim()}
            onClick={() => void cancel()}
            data-testid="payment-void-confirm"
          >
            {t("voidConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
