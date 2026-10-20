"use client";

import { Ban, Undo2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { PrintButton } from "@/components/pos/print-button";
import { Receipt } from "@/components/pos/receipt";
import { ShareReceiptButton } from "@/components/pos/share-receipt-button";
import { ReturnDialog } from "@/components/returns/return-dialog";
import { ReturnList } from "@/components/returns/return-list";
import { VoidSaleDialog } from "@/components/sales/void-sale-dialog";
import { BackLink } from "@/components/shared/back-link";
import { ListError } from "@/components/shared/load-more";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecord } from "@/data/hooks";
import type { ReturnDoc, Sale, SaleItem } from "@/db/local/types";
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
  const { role, storeName } = useProfile();
  const id = useSearchParams().get("id") ?? "";
  const [voiding, setVoiding] = useState(false);
  const [returning, setReturning] = useState(false);

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
  const allReturns = (loaded.extra.returns ?? []).filter(
    (r) => r.kind === "sale",
  ) as unknown as ReturnDoc[];
  // A cancelled return never happened, as far as what is left of the sale goes.
  const saleReturns = allReturns.filter(
    (r) => r.status !== "voided",
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

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <BackLink href="/sales" label={t("nav.sales")} />
      <div className="flex flex-wrap gap-2">
        <PrintButton sale={sale} items={items} storeName={storeName ?? ""} />
        <ShareReceiptButton
          sale={sale}
          items={items}
          storeName={storeName ?? ""}
        />
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

      <ReturnList
        returns={allReturns}
        title={t("returns.saleKind")}
        testId="sale-return-list"
      />

      <ReturnDialog
        kind="sale"
        refId={id}
        open={returning}
        onClose={() => setReturning(false)}
      />

      <VoidSaleDialog
        saleId={id}
        open={voiding}
        onClose={() => setVoiding(false)}
      />
    </div>
  );
}
