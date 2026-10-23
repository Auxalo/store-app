"use client";

import { Ban, Undo2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { ReturnDialog } from "@/components/returns/return-dialog";
import { ReturnList } from "@/components/returns/return-list";
import { BackLink } from "@/components/shared/back-link";
import { ListError } from "@/components/shared/load-more";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecord } from "@/data/hooks";
import type { Purchase, PurchaseItem, ReturnDoc } from "@/db/local/types";
import { useUnits } from "@/hooks/use-units";
import { useFormat } from "@/i18n/use-format";
import { VoidPurchaseDialog } from "./void-purchase-dialog";

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end font-medium">{children}</dd>
    </div>
  );
}

export function PurchaseViewScreen() {
  const t = useTranslations();
  const { name: unitName } = useUnits();
  const f = useFormat();
  const { role } = useProfile();
  const id = useSearchParams().get("id") ?? "";
  const [returning, setReturning] = useState(false);
  const [voiding, setVoiding] = useState(false);

  const allowed = can(role, "purchase.manage");
  const loaded = useRecord("purchases", allowed ? id : null);

  if (!can(role, "purchase.manage"))
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.noAccess")}
      </p>
    );
  if (loaded.status === "loading")
    return <Skeleton className="mx-auto h-72 w-full max-w-2xl" />;
  if (loaded.status === "error")
    return <ListError onRetry={() => window.location.reload()} />;
  if (!loaded.record || loaded.status === "missing")
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("purchases.notFound")}
      </p>
    );
  const p = loaded.record as Purchase;
  const items = ((loaded.record as unknown as { items?: PurchaseItem[] })
    .items ?? []) as PurchaseItem[];
  const returns = (loaded.extra.returns ?? []) as unknown as ReturnDoc[];
  const voided = p.status === "voided";
  const activeReturns = returns.filter((r) => r.status !== "voided").length;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <BackLink href="/purchases" label={t("nav.purchases")} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">
            {p.purchaseNo}
            {voided ? (
              <Badge
                variant="destructive"
                className="ms-2 align-middle"
                data-testid="purchase-voided"
              >
                {t("purchases.voided")}
              </Badge>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            {f.date(`${p.date}T12:00:00Z`)}
            {p.supplierId ? (
              <>
                {" · "}
                <Link
                  href={`/suppliers/view?id=${p.supplierId}`}
                  className="underline-offset-4 hover:underline"
                >
                  {p.supplierName}
                </Link>
              </>
            ) : null}
            {p.invoiceRef ? ` · ${p.invoiceRef}` : ""}
          </p>
        </div>
        {voided ? null : (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setReturning(true)}
              data-testid="return-goods"
            >
              <Undo2 aria-hidden />
              {t("purchases.returnGoods")}
            </Button>
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setVoiding(true)}
              data-testid="void-purchase"
            >
              <Ban aria-hidden />
              {t("purchases.voidPurchase")}
            </Button>
          </div>
        )}
      </div>
      {voided ? (
        <p
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
          data-testid="purchase-voided-note"
        >
          {t("purchases.voidedNote", {
            date: p.voidedAt ? f.dateTime(p.voidedAt) : "",
          })}
          {p.voidReason ? ` · ${p.voidReason}` : ""}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("purchases.items")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y" data-testid="purchase-items">
            {items.map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.productName}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.qty(i.qty)} {unitName(i.unit)} × {f.money(i.unitCost)}
                  </p>
                </div>
                <span className="shrink-0 font-semibold">
                  {f.money(i.lineTotal)}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 divide-y border-t pt-2">
            <Row label={t("purchases.subtotal")}>{f.money(p.subtotal)}</Row>
            {p.discount > 0 ? (
              <Row label={t("purchases.discount")}>−{f.money(p.discount)}</Row>
            ) : null}
            <Row label={t("purchases.total")}>{f.money(p.total)}</Row>
            <Row label={t("purchases.paid")}>
              {f.money(p.paid)} · {t(`payment.${p.paymentMethod}`)}
            </Row>
            {p.due > 0 ? (
              <Row label={t("purchases.dueAtPurchase")}>{f.money(p.due)}</Row>
            ) : null}
            {p.notes ? <Row label={t("purchases.notes")}>{p.notes}</Row> : null}
          </dl>
        </CardContent>
      </Card>

      <ReturnList
        returns={returns}
        title={t("returns.purchaseKind")}
        testId="purchase-return-list"
      />

      <VoidPurchaseDialog
        purchase={p}
        activeReturns={activeReturns}
        open={voiding}
        onClose={() => setVoiding(false)}
      />

      <ReturnDialog
        kind="purchase"
        refId={id}
        open={returning}
        onClose={() => setReturning(false)}
      />
    </div>
  );
}
