"use client";

import Link from "next/link";
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
import { useCommand, useRecord } from "@/data/hooks";
import { useFormat } from "@/i18n/use-format";
import { saleIdOfPayment } from "@/lib/sale-math";

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

  // Money a sale kept on the account belongs to that sale: while the sale stands, it is cancelled
  // from the sale (which can take this money with it), not from here.
  const saleId = payment ? saleIdOfPayment(payment.id) : null;
  const sale = useRecord("sales", saleId);
  const saleRecord = sale.record as
    | { id: string; invoiceNo?: string; status?: string }
    | undefined;
  const linkedSale =
    saleRecord && saleRecord.status !== "voided" ? saleRecord : null;
  const checking = !!saleId && sale.status === "loading";

  async function cancel() {
    if (!payment || !reason.trim() || linkedSale || checking) return;
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
        {linkedSale ? (
          <p
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm"
            data-testid="payment-linked-sale"
          >
            {t("linkedToSale", { invoice: linkedSale.invoiceNo ?? "" })}{" "}
            <Link
              href={`/sales/view?id=${linkedSale.id}`}
              className="font-medium text-primary underline"
            >
              {t("openSale")}
            </Link>
          </p>
        ) : null}
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
            disabled={!reason.trim() || !!linkedSale || checking}
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
