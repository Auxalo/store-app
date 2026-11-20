"use client";

import { Loader2, RefreshCw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { useCreateBarcode } from "@/hooks/use-labels";

/**
 * Gives a product a new short code of the shop's own in place of one starting with 2 (which some
 * shop tills read a price from). Asks first: labels already printed with the old code stop scanning.
 */
export function ReplaceCodeButton({
  product,
  compact = false,
}: {
  product: { id: string; barcode: string; version?: number };
  /** A small button (in a list row) instead of a full-width one. */
  compact?: boolean;
}) {
  const t = useTranslations("labels");
  const tc = useTranslations("common");
  const createBarcode = useCreateBarcode();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function replace() {
    setBusy(true);
    try {
      const code = await createBarcode(product);
      toast.success(t("newCodeDone", { code }));
      setAsking(false);
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={compact ? "sm" : "default"}
        onClick={() => setAsking(true)}
        disabled={busy}
        data-testid="replace-code"
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <RefreshCw aria-hidden />
        )}
        {compact ? t("newCodeShort") : t("newCode")}
      </Button>
      <AlertDialog open={asking} onOpenChange={(o) => !busy && setAsking(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("newCodeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("newCodeConfirmBody", { code: product.barcode })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {tc("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void replace();
              }}
              data-testid="replace-code-confirm"
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t("newCodeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
