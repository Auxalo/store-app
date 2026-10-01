"use client";

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLocalDb } from "@/db/local/db";
import { type StockFilter, searchProducts } from "@/db/local/queries/products";
import type { Product } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";
import { useSyncStore } from "@/sync/store";
import { StockAdjustDialog } from "./stock-adjust-dialog";
import { StockBadge } from "./stock-badge";

const ROW_HEIGHT = 76;
const PAGE = 100;

/**
 * The product list used by both "Products" (browse and edit) and "Inventory" (stock levels and
 * adjustments). Search runs on the device's index, and only the rows on screen are rendered,
 * so it stays smooth with tens of thousands of products on a phone.
 */
export function ProductCatalog({ mode }: { mode: "products" | "inventory" }) {
  const t = useTranslations();
  const f = useFormat();
  const { role } = useProfile();
  const locale = usePreferences((s) => s.locale);
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [category, setCategory] = useState("all");
  const [stock, setStock] = useState<StockFilter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [adjusting, setAdjusting] = useState<Product | null>(null);

  const canSeeCost = can(role, "purchasePrice.view");
  const canCreate = can(role, "product.create");
  const canAdjust = can(role, "stock.adjust");

  // biome-ignore lint/correctness/useExhaustiveDependencies: restart paging whenever the filters change
  useEffect(() => setLimit(PAGE), [deferredQuery, category, stock]);

  const categories = useLiveQuery(
    () =>
      getLocalDb()
        .categories.filter((c) => !c.deletedAt)
        .sortBy("name"),
    [],
  );
  const categoryName = new Map(
    (categories ?? []).map((c) => [
      c.id,
      locale === "bn" && c.nameBn ? c.nameBn : c.name,
    ]),
  );

  const products = useLiveQuery(
    () =>
      searchProducts(getLocalDb(), {
        query: deferredQuery,
        categoryId: category === "all" ? undefined : category,
        stock,
        includeInactive: mode === "products",
        limit,
      }),
    [deferredQuery, category, stock, limit, mode],
  );

  const listRef = useRef<HTMLDivElement>(null);
  const items = products ?? [];
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Near the bottom of what is loaded: load another page.
  const lastIndex = virtualItems.at(-1)?.index ?? 0;
  useEffect(() => {
    if (items.length === limit && lastIndex >= items.length - 12)
      setLimit((l) => l + PAGE * 2);
  }, [lastIndex, items.length, limit]);

  const name = (p: Product) =>
    locale === "bn" && p.nameBn ? p.nameBn : p.name;
  const otherName = (p: Product) =>
    locale === "bn" ? (p.nameBn ? p.name : "") : p.nameBn;
  const emptyKey =
    mode === "inventory" && stock === "low"
      ? "inventory.emptyLow"
      : mode === "inventory" && stock === "out"
        ? "inventory.emptyOut"
        : query || category !== "all"
          ? "products.noMatch"
          : "products.empty";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("products.searchPlaceholder")}
            aria-label={t("products.searchPlaceholder")}
            className="ps-9"
            inputMode="search"
            enterKeyHint="search"
          />
        </div>
        {mode === "products" && canCreate ? (
          <Button asChild>
            <Link href="/products/new">
              <Plus aria-hidden />
              <span className="max-sm:sr-only">{t("products.add")}</span>
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {mode === "inventory" ? (
          <Tabs value={stock} onValueChange={(v) => setStock(v as StockFilter)}>
            <TabsList>
              <TabsTrigger value="all">{t("inventory.tabAll")}</TabsTrigger>
              <TabsTrigger value="low">{t("inventory.tabLow")}</TabsTrigger>
              <TabsTrigger value="out">{t("inventory.tabOut")}</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger
            className="min-w-40"
            aria-label={t("products.category")}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("products.allCategories")}</SelectItem>
            {(categories ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {categoryName.get(c.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {products === undefined || (!initialSyncDone && items.length === 0) ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[68px] w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t(emptyKey)}
        </p>
      ) : (
        <div ref={listRef}>
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualItems.map((row) => {
              const p = items[row.index];
              const negative = p.stock < 0;
              const body = (
                <div
                  className={cn(
                    "flex h-[68px] items-center gap-3 rounded-xl border bg-card px-3 transition-colors",
                    mode === "products" && "hover:bg-muted/50",
                    !p.isActive && "opacity-60",
                  )}
                  data-testid="product-row"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{name(p)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        otherName(p),
                        p.sku,
                        p.categoryId ? categoryName.get(p.categoryId) : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {mode === "products" && canSeeCost ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {t("products.purchasePrice")}:{" "}
                        {f.money(p.purchasePrice)}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 text-end">
                    {mode === "products" ? (
                      <span className="font-semibold">
                        {f.money(p.sellingPrice)}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "text-sm",
                        negative && "font-semibold text-destructive",
                      )}
                      title={negative ? t("inventory.negativeHint") : undefined}
                    >
                      {f.qty(p.stock)} {t(`units.${p.unit}`)}
                    </span>
                    <StockBadge product={p} />
                  </div>
                  {mode === "inventory" && canAdjust ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAdjusting(p)}
                    >
                      {t("products.adjustStock")}
                    </Button>
                  ) : null}
                </div>
              );
              return (
                <div
                  key={row.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: row.size,
                    transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  {mode === "products" ? (
                    <Link href={`/products/view?id=${p.id}`} className="block">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <StockAdjustDialog
        product={adjusting}
        onClose={() => setAdjusting(null)}
      />
    </div>
  );
}
