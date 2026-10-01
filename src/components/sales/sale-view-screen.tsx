"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Ban, Printer, Undo2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { Receipt } from "@/components/pos/receipt";
import { ReturnDialog } from "@/components/returns/return-dialog";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocalDb } from "@/db/local/db";
import { useCommands } from "@/sync/use-commands";

export function SaleViewScreen() {
  const t = useTranslations();
  const run = useCommands();
  const { role, storeName } = useProfile();
  const id = useSearchParams().get("id") ?? "";
  const [voiding, setVoiding] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");

  const data = useLiveQuery(async () => {
    const db = getLocalDb();
    const sale = await db.sales.get(id);
    if (!sale) return null;
    const items = await db.saleItems.where("saleId").equals(id).toArray();
    items.sort(
      (a, b) => Number(a.id.split(":i")[1]) - Number(b.id.split(":i")[1]),
    );
    return { sale, items };
  }, [id]);

  if (data === undefined)
    return <Skeleton className="mx-auto h-72 w-full max-w-md" />;
  if (data === null)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("sales.notFound")}
      </p>
    );
  const { sale, items } = data;

  async function voidSale() {
    try {
      await run("sale.void", { saleId: id, reason });
      setVoiding(false);
      setReason("");
    } catch {
      toast.error(t("common.somethingWrong"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer aria-hidden />
          {t("pos.printReceipt")}
        </Button>
        {can(role, "sale.void") && sale.status === "active" ? (
          <Button
            variant="outline"
            onClick={() => setReturning(true)}
            data-testid="return-items"
          >
            <Undo2 aria-hidden />
            {t("returns.title")}
          </Button>
        ) : null}
        {can(role, "sale.void") && sale.status === "active" ? (
          <Button
            variant="outline"
            onClick={() => setVoiding(true)}
            data-testid="void-sale"
          >
            <Ban aria-hidden />
            {t("sales.voidSale")}
          </Button>
        ) : null}
      </div>

      <div
        className="rounded-xl border bg-muted/30 p-2"
        data-testid="receipt-preview"
      >
        <Receipt sale={sale} items={items} storeName={storeName ?? ""} />
      </div>

      <ReturnDialog
        kind="sale"
        refId={id}
        open={returning}
        onClose={() => setReturning(false)}
      />

      <AlertDialog open={voiding} onOpenChange={setVoiding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sales.voidTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sales.voidBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("sales.voidReason")}
            aria-label={t("sales.voidReason")}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void voidSale()}>
              {t("sales.voidConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
