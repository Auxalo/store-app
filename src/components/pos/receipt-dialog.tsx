"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProfile } from "@/auth/use-auth";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useRecord } from "@/data/hooks";
import type { Sale, SaleItem } from "@/db/local/types";
import { PrintButton } from "./print-button";
import { Receipt } from "./receipt";
import { ShareReceiptButton } from "./share-receipt-button";

/** Shown right after a sale: the receipt, ready to print, and a button for the next customer. */
export function ReceiptDialog({
  saleId,
  onClose,
}: {
  saleId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("pos");
  const { storeName } = useProfile();

  const loaded = useRecord("sales", saleId);
  const data = loaded.record
    ? {
        sale: loaded.record as Sale,
        items: ((loaded.record as unknown as { items?: SaleItem[] }).items ??
          []) as SaleItem[],
      }
    : null;

  return (
    <ResponsiveDialog
      open={saleId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("saleDone")}
    >
      {data ? (
        <div className="flex flex-col gap-3">
          <div className="max-h-[55dvh] overflow-y-auto rounded-lg border bg-muted/30 p-2">
            <Receipt
              sale={data.sale}
              items={data.items}
              storeName={storeName ?? ""}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <ShareReceiptButton
              sale={data.sale}
              items={data.items}
              storeName={storeName ?? ""}
            />
            <PrintButton
              sale={data.sale}
              items={data.items}
              storeName={storeName ?? ""}
              autoPrint
            />
            <Button onClick={onClose} autoFocus>
              <Plus aria-hidden />
              {t("newSale")}
            </Button>
          </div>
        </div>
      ) : loaded.status === "loading" ? null : (
        <div className="flex flex-col gap-3" data-testid="receipt-unavailable">
          <p className="text-sm text-muted-foreground">
            {t("receiptUnavailable")}
          </p>
          <Button onClick={onClose} autoFocus>
            <Plus aria-hidden />
            {t("newSale")}
          </Button>
        </div>
      )}
    </ResponsiveDialog>
  );
}
