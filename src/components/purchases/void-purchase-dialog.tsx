"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { refusalCode } from "@/components/returns/void-reason";
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
import type { Purchase } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";

/**
 * Cancels a purchase entered by mistake (a wrong amount or payment method). It says plainly what
 * happens: the goods leave stock, what it put on the supplier's account comes off, the money paid
 * is cancelled (counted back today) and so is any extra kept on the supplier's account. A purchase
 * with returns that stand cannot be cancelled until those returns are cancelled.
 */
export function VoidPurchaseDialog({
  purchase,
  activeReturns,
  open,
  onClose,
}: {
  purchase: Purchase;
  activeReturns: number;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("purchases");
  const tc = useTranslations("common");
  const tp = useTranslations("payment");
  const ts = useTranslations("sync.reasons");
  const f = useFormat();
  const run = useCommand();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // The extra kept on the supplier's account (looked up only while the window is open).
  const linked = useRecord("payments", open ? `${purchase.id}:p` : null);
  const extra = linked.record as
    | { amount: number; status?: string }
    | undefined;
  const kept = extra && extra.status !== "voided" ? extra.amount : 0;

  async function cancel() {
    setBusy(true);
    try {
      await run("purchase.void", {
        purchaseId: purchase.id,
        reason: reason.trim(),
      });
      toast.success(t("voidDone", { no: purchase.purchaseNo }));
      setReason("");
      onClose();
    } catch (error) {
      const code = refusalCode(error);
      toast.error(
        ts.has(code as never) ? ts(code as never) : tc("somethingWrong"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason("");
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("voidTitle", { no: purchase.purchaseNo })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("voidBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        {activeReturns > 0 ? (
          <p
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm"
            data-testid="void-purchase-has-returns"
          >
            {t("voidHasReturns")}
          </p>
        ) : (
          <ul
            className="list-disc space-y-1 ps-5 text-sm"
            data-testid="void-purchase-effects"
          >
            <li>{t("voidGoods")}</li>
            {purchase.paid > 0 ? (
              <li>
                {t("voidPaid", {
                  value: f.money(purchase.paid),
                  method: tp(purchase.paymentMethod),
                })}
              </li>
            ) : null}
            {purchase.due > 0 ? (
              <li>
                {t("voidDue", {
                  name: purchase.supplierName,
                  value: f.money(purchase.due),
                })}
              </li>
            ) : null}
            {kept > 0 ? (
              <li data-testid="void-purchase-kept">
                {t("voidKept", { value: f.money(kept) })}
              </li>
            ) : null}
            <li>{t("voidAgain")}</li>
          </ul>
        )}
        <Input
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("voidReason")}
          aria-label={t("voidReason")}
          disabled={activeReturns > 0}
          data-testid="void-purchase-reason"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || activeReturns > 0 || linked.status === "loading"}
            onClick={(e) => {
              e.preventDefault();
              void cancel();
            }}
            data-testid="void-purchase-confirm"
          >
            {t("voidConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
