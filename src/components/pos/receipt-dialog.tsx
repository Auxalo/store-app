"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Printer } from "lucide-react";
import { useTranslations } from "next-intl";
import { useProfile } from "@/auth/use-auth";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { getLocalDb } from "@/db/local/db";
import { Receipt } from "./receipt";

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

  const data = useLiveQuery(async () => {
    if (!saleId) return null;
    const db = getLocalDb();
    const sale = await db.sales.get(saleId);
    if (!sale) return null;
    const items = await db.saleItems.where("saleId").equals(saleId).toArray();
    items.sort(
      (a, b) => Number(a.id.split(":i")[1]) - Number(b.id.split(":i")[1]),
    );
    return { sale, items };
  }, [saleId]);

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
            <Button variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden />
              {t("printReceipt")}
            </Button>
            <Button onClick={onClose} autoFocus>
              <Plus aria-hidden />
              {t("newSale")}
            </Button>
          </div>
        </div>
      ) : null}
    </ResponsiveDialog>
  );
}
