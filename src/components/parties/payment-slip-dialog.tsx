"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { useProfile } from "@/auth/use-auth";
import { PrintAction } from "@/components/pos/print-button";
import { SlipPaper } from "@/components/pos/slip-paper";
import type { StoreProfile } from "@/components/settings/settings-screen";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useRecord } from "@/data/hooks";
import { useSetting } from "@/hooks/use-setting";
import { useFormat } from "@/i18n/use-format";
import { buildPaymentSlipModel } from "@/lib/print/slip-model";
import { usePrintReceipt } from "@/lib/print/use-print-receipt";

const NO_PROFILE: StoreProfile = { name: "", address: "", phone: "" };

export interface PaymentSlipRequest {
  paymentId: string;
  /** What the customer owed just before this payment, or null when not known. */
  before: number | null;
  /** Where they stand now: more than 0 is due, less than 0 is advance. */
  after: number;
  /** Print by itself when the device is set to (right after taking the payment). */
  fresh?: boolean;
}

/**
 * A short payment slip: the payment, and what the customer still owes (or holds in advance).
 * Shown right after taking a payment, and from the customer's statement for any earlier one.
 */
export function PaymentSlipDialog({
  slip,
  onClose,
}: {
  slip: PaymentSlipRequest | null;
  onClose: () => void;
}) {
  const t = useTranslations("receipt");
  const tp = useTranslations("payment");
  const tc = useTranslations("party");
  const f = useFormat();
  const { storeName } = useProfile();
  const profile = useSetting<StoreProfile>("store.profile", NO_PROFILE).value;
  const footer = useSetting<string>("receipt.footer", "").value;
  const { printModel } = usePrintReceipt();
  const loaded = useRecord("payments", slip?.paymentId ?? null);
  const payment = loaded.record;

  const model = useMemo(
    () =>
      slip && payment
        ? buildPaymentSlipModel({
            payment: {
              createdAt: payment.createdAt,
              amount: payment.amount,
              method: payment.method,
              partyName: payment.partyName,
            },
            before: slip.before,
            after: slip.after,
            storeName: storeName ?? "",
            profile,
            footer,
            t: (key, values) => t(key as never, values as never),
            tp: (method) => tp(method as never),
            f,
          })
        : null,
    [slip, payment, storeName, profile, footer, t, tp, f],
  );

  return (
    <ResponsiveDialog
      open={slip !== null}
      onOpenChange={(open) => !open && onClose()}
      title={tc("slipTitle")}
    >
      {model && slip ? (
        <div className="flex flex-col gap-3">
          <div className="max-h-[55dvh] overflow-y-auto rounded-lg border bg-muted/30 p-2">
            <SlipPaper model={model} />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <PrintAction autoPrint={slip.fresh} run={() => printModel(model)} />
            <Button
              variant="outline"
              onClick={onClose}
              data-testid="slip-close"
            >
              {tc("slipClose")}
            </Button>
          </div>
        </div>
      ) : loaded.status === "loading" ? null : (
        <p className="text-sm text-muted-foreground">{tc("slipUnavailable")}</p>
      )}
    </ResponsiveDialog>
  );
}
