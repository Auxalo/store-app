"use client";

import { Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useCommand, useRecord } from "@/data/hooks";
import type { Product, StockMovement } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";
import { StockAdjustDialog } from "./stock-adjust-dialog";
import { StockBadge } from "./stock-badge";

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

export function ProductViewScreen() {
  const t = useTranslations();
  const f = useFormat();
  const router = useRouter();
  const run = useCommand();
  const { role } = useProfile();
  const locale = usePreferences((s) => s.locale);
  const id = useSearchParams().get("id") ?? "";

  const [adjusting, setAdjusting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loaded = useRecord("products", id);
  const product = loaded.record as Product | undefined;
  const categories = useCategories();
  const category = product?.categoryId
    ? categories?.find((c) => c.id === product.categoryId)
    : undefined;
  const movements = (loaded.extra.stockMovements ??
    []) as unknown as StockMovement[];

  if (loaded.status === "loading")
    return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  if (loaded.status === "error")
    return <ListError onRetry={() => router.refresh()} />;
  if (!product || loaded.status === "missing" || product.deletedAt) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.notFound")}
      </p>
    );
  }

  const unit = t(`units.${product.unit}`);
  const title = product.name;

  async function remove() {
    try {
      await run("product.delete", { id }, { baseVersion: product?.version });
      router.replace("/products");
    } catch {
      toast.error(t("common.somethingWrong"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">{title}</h2>
        </div>
        <div className="flex shrink-0 gap-2">
          {can(role, "product.edit") ? (
            <Button
              asChild
              variant="outline"
              size="icon"
              aria-label={t("common.edit")}
            >
              <Link href={`/products/edit?id=${id}`}>
                <Pencil aria-hidden />
              </Link>
            </Button>
          ) : null}
          {can(role, "product.edit") ? (
            <Button
              variant="outline"
              size="icon"
              aria-label={t("common.delete")}
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">
                {t("products.stock")}
              </p>
              <p
                className={cn(
                  "text-3xl font-semibold",
                  product.stock < 0 && "text-destructive",
                )}
              >
                {f.qty(product.stock)}{" "}
                <span className="text-base font-normal text-muted-foreground">
                  {unit}
                </span>
              </p>
              <div className="mt-1">
                <StockBadge product={product} />
              </div>
            </div>
            {can(role, "stock.adjust") ? (
              <Button onClick={() => setAdjusting(true)}>
                <SlidersHorizontal aria-hidden />
                {t("products.adjustStock")}
              </Button>
            ) : null}
          </div>
          <dl className="mt-3 divide-y">
            <Row label={t("products.sellingPrice")}>
              {f.money(product.sellingPrice)}
            </Row>
            {can(role, "purchasePrice.view") &&
            product.purchasePrice !== undefined ? (
              <Row label={t("products.purchasePrice")}>
                {f.money(product.purchasePrice)}
              </Row>
            ) : null}
            {product.sku ? (
              <Row label={t("products.sku")}>{product.sku}</Row>
            ) : null}
            {product.barcode ? (
              <Row label={t("products.barcode")}>{product.barcode}</Row>
            ) : null}
            {category ? (
              <Row label={t("products.category")}>
                {locale === "bn" && category.nameBn
                  ? category.nameBn
                  : category.name}
              </Row>
            ) : null}
            {product.lowStockThreshold > 0 ? (
              <Row label={t("products.lowStockThreshold")}>
                {f.qty(product.lowStockThreshold)} {unit}
              </Row>
            ) : null}
            {product.description ? (
              <Row label={t("products.description")}>{product.description}</Row>
            ) : null}
            {!product.isActive ? (
              <Row label={t("products.active")}>
                <Badge variant="secondary">{t("products.inactive")}</Badge>
              </Row>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("products.history")}</CardTitle>
        </CardHeader>
        <CardContent>
          {movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("products.noHistory")}
            </p>
          ) : (
            <ul className="divide-y" data-testid="movement-list">
              {movements.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                  data-testid="movement-row"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t(`inventory.movementTypes.${m.type}`)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {f.dateTime(m.createdAt)}
                      {m.note ? ` · ${m.note}` : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-semibold",
                      m.qtyDelta < 0 ? "text-destructive" : "text-emerald-600",
                    )}
                  >
                    {m.qtyDelta > 0 ? "+" : ""}
                    {f.qty(m.qtyDelta)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <StockAdjustDialog
        product={adjusting ? product : null}
        onClose={() => setAdjusting(false)}
      />

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("products.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("products.deleteBody", { name: title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
