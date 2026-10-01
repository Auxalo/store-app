"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { type StockStatus, stockStatus } from "@/db/local/queries/products";
import type { Product } from "@/db/local/types";

export function StockBadge({
  product,
}: {
  product: Pick<Product, "stock" | "lowStockThreshold">;
}) {
  const t = useTranslations("products");
  const status: StockStatus = stockStatus(product);
  if (status === "ok") return null;
  return (
    <Badge variant={status === "out" ? "destructive" : "secondary"}>
      {status === "out" ? t("outBadge") : t("lowBadge")}
    </Badge>
  );
}
