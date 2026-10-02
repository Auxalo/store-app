"use client";

import { Undo2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { ReturnDialog } from "@/components/returns/return-dialog";
import { ListError } from "@/components/shared/load-more";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecord } from "@/data/hooks";
import type { Purchase, PurchaseItem, ReturnDoc } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { usePreferences } from "@/stores/preferences";

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
  const f = useFormat();
  const { role } = useProfile();
  const locale = usePreferences((s) => s.locale);
  const id = useSearchParams().get("id") ?? "";
  const [returning, setReturning] = useState(false);

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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">{p.purchaseNo}</h2>
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
        <Button
          variant="outline"
          onClick={() => setReturning(true)}
          data-testid="return-goods"
        >
          <Undo2 aria-hidden />
          {t("purchases.returnGoods")}
        </Button>
      </div>

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
                  <p className="truncate font-medium">
                    {locale === "bn" && i.productNameBn
                      ? i.productNameBn
                      : i.productName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.qty(i.qty)} {t(`units.${i.unit}`)} ×{" "}
                    {f.money(i.unitCost)}
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
              <Row label={t("purchases.due")}>{f.money(p.due)}</Row>
            ) : null}
            {p.notes ? <Row label={t("purchases.notes")}>{p.notes}</Row> : null}
          </dl>
        </CardContent>
      </Card>

      {returns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("returns.purchaseKind")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y" data-testid="purchase-returns">
              {returns.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span>
                    {r.returnNo} · {f.dateTime(r.createdAt)}
                  </span>
                  <span className="font-semibold">{f.money(r.total)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <ReturnDialog
        kind="purchase"
        refId={id}
        open={returning}
        onClose={() => setReturning(false)}
      />
    </div>
  );
}
