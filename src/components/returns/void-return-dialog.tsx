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
import type { ReturnDoc } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { returnSplit } from "@/lib/refund";
import { refusalCode } from "./void-reason";

/**
 * Cancels a return made by mistake. It says plainly what will go back: the goods, the amount that
 * was taken off a balance (or kept as credit), and the cash back (counted back today). The return
 * stays on record, marked cancelled.
 */
export function VoidReturnDialog({
  ret,
  onClose,
}: {
  ret: ReturnDoc | null;
  onClose: () => void;
}) {
  const t = useTranslations("returns");
  const tc = useTranslations("common");
  const ts = useTranslations("sync.reasons");
  const f = useFormat();
  const run = useCommand();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const split = ret ? returnSplit(ret) : { cashBack: 0, credited: 0 };
  const sale = ret?.kind === "sale";

  async function cancel() {
    if (!ret) return;
    setBusy(true);
    try {
      await run("return.void", { id: ret.id, reason: reason.trim() });
      toast.success(t("voidDone", { no: ret.returnNo }));
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
      open={ret !== null}
      onOpenChange={(open) => {
        if (!open) {
          setReason("");
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("voidTitle", { no: ret?.returnNo ?? "" })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t("voidBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul
          className="list-disc space-y-1 ps-5 text-sm"
          data-testid="void-return-effects"
        >
          {sale ? (
            ret?.restock ? (
              <li>{t("voidGoodsSale")}</li>
            ) : null
          ) : (
            <li>{t("voidGoodsPurchase")}</li>
          )}
          {split.credited > 0 && ret ? (
            <li>
              {sale
                ? t("voidCreditCustomer", {
                    name: ret.partyName,
                    value: f.money(split.credited),
                  })
                : t("voidCreditSupplier", {
                    name: ret.partyName,
                    value: f.money(split.credited),
                  })}
            </li>
          ) : null}
          {split.cashBack > 0 ? (
            <li>
              {sale
                ? t("voidCashSale", { value: f.money(split.cashBack) })
                : t("voidCashPurchase", { value: f.money(split.cashBack) })}
            </li>
          ) : null}
        </ul>
        <Input
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("voidReason")}
          aria-label={t("voidReason")}
          data-testid="void-return-reason"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              void cancel();
            }}
            data-testid="void-return-confirm"
          >
            {t("voidConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
