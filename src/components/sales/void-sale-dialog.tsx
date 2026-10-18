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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useCommand, useRecord } from "@/data/hooks";
import { useFormat } from "@/i18n/use-format";
import { saleRecordIds } from "@/lib/sale-math";

/**
 * Cancels a sale. When the sale kept extra money on the customer's account (a payment of its own),
 * the person is asked whether that money goes too: cancelling only the sale would leave it behind.
 * It is only looked up while the dialog is open.
 */
export function VoidSaleDialog({
  saleId,
  open,
  onClose,
}: {
  saleId: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("sales");
  const tc = useTranslations("common");
  const f = useFormat();
  const run = useCommand();
  const [reason, setReason] = useState("");
  const [alsoPayment, setAlsoPayment] = useState(true);

  const linked = useRecord(
    "payments",
    open ? saleRecordIds.payment(saleId) : null,
  );
  const payment = linked.record as
    | { amount: number; status?: string }
    | undefined;
  const kept =
    payment && payment.status !== "voided" && payment.amount > 0
      ? payment.amount
      : 0;

  async function cancel() {
    try {
      await run("sale.void", {
        saleId,
        reason,
        voidPayment: kept > 0 && alsoPayment,
      });
      setReason("");
      onClose();
    } catch {
      toast.error(tc("somethingWrong"));
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("voidTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("voidBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        {kept > 0 ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm"
            data-testid="void-linked-payment"
          >
            <Checkbox
              id="void-payment"
              checked={alsoPayment}
              onCheckedChange={(v) => setAlsoPayment(v === true)}
              data-testid="void-payment-check"
            />
            <label htmlFor="void-payment" className="min-w-0 flex-1">
              {t("voidWithPayment", { value: f.money(kept) })}
              <span className="block text-xs text-muted-foreground">
                {alsoPayment ? t("voidWithPaymentOn") : t("voidWithPaymentOff")}
              </span>
            </label>
          </div>
        ) : null}
        <Input
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("voidReason")}
          aria-label={t("voidReason")}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={linked.status === "loading"}
            onClick={() => void cancel()}
            data-testid="void-sale-confirm"
          >
            {t("voidConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
