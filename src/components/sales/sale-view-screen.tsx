"use client";

import { Ban, Printer, Undo2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { Receipt } from "@/components/pos/receipt";
import { ReturnDialog } from "@/components/returns/return-dialog";
import { ListError } from "@/components/shared/load-more";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommand, useRecord } from "@/data/hooks";
import type { Sale, SaleItem } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { isFullyReturned, returnSplit } from "@/lib/refund";

interface ReturnRecord {
  id: string;
  total: number;
  cashBack?: number;
  credited?: number;
  settlement?: "cash" | "credit";
  lines: Array<{ itemIndex: number; qty: number; productName: string }>;
}

export function SaleViewScreen() {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommand();
  const { role, storeName } = useProfile();
  const id = useSearchParams().get("id") ?? "";
  const [voiding, setVoiding] = useState(false);
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");

  const loaded = useRecord("sales", id);
  if (loaded.status === "loading")
    return <Skeleton className="mx-auto h-72 w-full max-w-md" />;
  if (loaded.status === "error")
    return <ListError onRetry={() => window.location.reload()} />;
  if (!loaded.record || loaded.status === "missing")
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("sales.notFound")}
      </p>
    );
  const sale = loaded.record as Sale;
  const items = ((loaded.record as unknown as { items?: SaleItem[] }).items ??
    []) as SaleItem[];

  // Everything has come back already: the return and cancel actions have nothing left to do.
  const saleReturns = (loaded.extra.returns ?? []).filter(
    (r) => r.kind === "sale",
  ) as unknown as ReturnRecord[];
  const returnedTotal = saleReturns.reduce((sum, r) => sum + r.total, 0);
  const fullyReturned =
    sale.status === "active" &&
    isFullyReturned(
      items.map((i) => Number(i.qty)),
      saleReturns,
    );
  // Once anything has come back, the rest also comes back as a return: cancelling would reverse
  // the same stock and money twice.
  const partlyReturned =
    sale.status === "active" && saleReturns.length > 0 && !fullyReturned;

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
        {fullyReturned ? (
          <Badge variant="secondary" data-testid="fully-returned">
            {t("sales.fullyReturned")}
          </Badge>
        ) : null}
        {partlyReturned ? (
          <Badge variant="secondary" data-testid="partly-returned">
            {t("sales.partlyReturned")}
          </Badge>
        ) : null}
        {can(role, "sale.void") &&
        sale.status === "active" &&
        !fullyReturned ? (
          <Button
            variant="outline"
            onClick={() => setReturning(true)}
            data-testid="return-items"
          >
            <Undo2 aria-hidden />
            {partlyReturned ? t("returns.returnRest") : t("returns.title")}
          </Button>
        ) : null}
        {can(role, "sale.void") &&
        sale.status === "active" &&
        saleReturns.length === 0 ? (
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

      {sale.due > 0 ? (
        <p
          className="text-xs text-muted-foreground"
          data-testid="due-at-sale-note"
        >
          {t("sales.dueAtSaleNote")}
        </p>
      ) : null}
      {saleReturns.length > 0 ? (
        <div
          className="space-y-2 rounded-xl border bg-card p-3 text-sm print:hidden"
          data-testid="sale-returns"
        >
          <p className="font-semibold">{t("sales.returnedHeading")}</p>
          {saleReturns.map((r) => {
            const split = returnSplit(r);
            return (
              <div key={r.id} className="space-y-0.5" data-testid="sale-return">
                {r.lines.map((l) => (
                  <p key={l.itemIndex} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {items[l.itemIndex]?.productName ?? l.productName}
                    </span>
                    <span className="shrink-0">
                      {t("sales.returnedQty", { n: f.qty(l.qty) })}
                    </span>
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">
                  {[
                    split.credited > 0
                      ? t("sales.returnCredited", {
                          value: f.money(split.credited),
                        })
                      : "",
                    split.cashBack > 0
                      ? t("sales.returnCash", {
                          value: f.money(split.cashBack),
                        })
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            );
          })}
          <div className="flex justify-between border-t pt-2">
            <span>{t("sales.returnedTotal")}</span>
            <span data-testid="returned-total">−{f.money(returnedTotal)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>{t("sales.netAfterReturns")}</span>
            <span data-testid="net-after-returns">
              {f.money(Math.max(0, sale.total - returnedTotal))}
            </span>
          </div>
        </div>
      ) : null}
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
