"use client";

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useDebounceValue } from "usehooks-ts";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import {
  type FilterField,
  type FilterValues,
  ListToolbar,
} from "@/components/shared/list-toolbar";
import { ListError } from "@/components/shared/load-more";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCategories, useList, usePrefetchRecord } from "@/data/hooks";
import { useDataMode } from "@/data/mode-store";
import type { Product } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import type { StockFilter } from "@/lib/stock-status";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";
import { useSyncStore } from "@/sync/store";
import { StockAdjustDialog } from "./stock-adjust-dialog";
import { StockBadge } from "./stock-badge";

const ROW_HEIGHT = 76;
const PAGE = 100;
const ALL = "all";
const SORTS = ["name", "stock", "price", "newest"] as const;

/**
 * The product list used by both "Products" (browse and edit) and "Inventory" (stock levels and
 * adjustments). Online it asks the server a page at a time; offline it reads the copy on the
 * device. Either way only the rows on screen are drawn, so it stays smooth with a huge catalogue.
 */
export function ProductCatalog({ mode }: { mode: "products" | "inventory" }) {
  const t = useTranslations();
  const f = useFormat();
  const { role } = useProfile();
  const locale = usePreferences((s) => s.locale);
  const dataMode = useDataMode();
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);

  const [search, setSearch] = useState("");
  const [q] = useDebounceValue(search.trim(), 200);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("name");
  const [filters, setFilters] = useState<FilterValues>({
    category: ALL,
    active: ALL,
    stock: ALL,
  });
  const [adjusting, setAdjusting] = useState<Product | null>(null);

  const canSeeCost = can(role, "purchasePrice.view");
  const canCreate = can(role, "product.create");
  const canAdjust = can(role, "stock.adjust");

  const prefetch = usePrefetchRecord();
  const categories = useCategories();
  const categoryName = new Map(
    (categories ?? []).map((c) => [
      c.id,
      locale === "bn" && c.nameBn ? c.nameBn : c.name,
    ]),
  );

  const stock = filters.stock as StockFilter;
  const list = useList(
    "products",
    {
      q,
      categoryId:
        filters.category === ALL ? undefined : (filters.category as string),
      stock,
      // Products shows everything (to edit it); Inventory only what is for sale.
      active:
        mode === "products"
          ? (filters.active as "all" | "active" | "inactive")
          : "active",
      sort,
    },
    { pageSize: PAGE },
  );
  const items = list.items;

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });
  const virtualItems = virtualizer.getVirtualItems();

  // Near the bottom of what is loaded: get the next page.
  const lastIndex = virtualItems.at(-1)?.index ?? 0;
  const { hasMore, loadMore } = list;
  useEffect(() => {
    if (hasMore && lastIndex >= items.length - 12) loadMore();
  }, [lastIndex, items.length, hasMore, loadMore]);

  const name = (p: Product) =>
    locale === "bn" && p.nameBn ? p.nameBn : p.name;
  const otherName = (p: Product) =>
    locale === "bn" ? (p.nameBn ? p.name : "") : p.nameBn;
  const filtered =
    q !== "" ||
    filters.category !== ALL ||
    (mode === "products" && filters.active !== ALL) ||
    (mode === "products" && stock !== "all");
  const emptyKey =
    mode === "inventory" && stock === "low"
      ? "inventory.emptyLow"
      : mode === "inventory" && stock === "out"
        ? "inventory.emptyOut"
        : filtered
          ? "products.noMatch"
          : "products.empty";

  const fields: FilterField[] = [
    {
      kind: "choice",
      key: "category",
      label: t("products.category"),
      none: ALL,
      options: [
        { value: ALL, label: t("products.allCategories") },
        ...(categories ?? []).map((c) => ({
          value: c.id,
          label: categoryName.get(c.id) ?? c.name,
        })),
      ],
    },
    ...(mode === "products"
      ? ([
          {
            kind: "choice",
            key: "active",
            label: t("products.filterActive"),
            none: ALL,
            options: [
              { value: ALL, label: t("products.activeAll") },
              { value: "active", label: t("products.active") },
              { value: "inactive", label: t("products.inactive") },
            ],
          },
          {
            kind: "choice",
            key: "stock",
            label: t("products.stock"),
            none: ALL,
            options: [
              { value: ALL, label: t("inventory.tabAll") },
              { value: "low", label: t("inventory.tabLow") },
              { value: "out", label: t("inventory.tabOut") },
            ],
          },
        ] satisfies FilterField[])
      : []),
  ];

  const waiting =
    list.status === "loading" ||
    (items.length === 0 && dataMode === "offline" && !initialSyncDone);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder={t("products.searchPlaceholder")}
        fields={fields}
        values={filters}
        onValue={(key, value) => setFilters((c) => ({ ...c, [key]: value }))}
        sort={sort}
        sortOptions={SORTS.map((s) => ({
          value: s,
          label: t(`products.sort.${s}`),
        }))}
        onSort={(v) => setSort(v as (typeof SORTS)[number])}
        onClear={() =>
          setFilters((c) => ({
            ...c,
            category: ALL,
            active: ALL,
            stock: mode === "inventory" ? c.stock : ALL,
          }))
        }
        trailing={
          mode === "products" && canCreate ? (
            <Button asChild>
              <Link href="/products/new">
                <Plus aria-hidden />
                <span className="max-sm:sr-only">{t("products.add")}</span>
              </Link>
            </Button>
          ) : null
        }
      />

      {mode === "inventory" ? (
        <Tabs
          value={stock}
          onValueChange={(v) => setFilters((c) => ({ ...c, stock: v }))}
        >
          <TabsList>
            <TabsTrigger value="all">{t("inventory.tabAll")}</TabsTrigger>
            <TabsTrigger value="low">{t("inventory.tabLow")}</TabsTrigger>
            <TabsTrigger value="out">{t("inventory.tabOut")}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      {list.status === "error" ? (
        <ListError onRetry={list.refetch} />
      ) : waiting ? (
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
        <div ref={listRef} className={cn(list.isRefreshing && "opacity-60")}>
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualItems.map((row) => {
              const p = items[row.index];
              if (!p) return null;
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
                    {mode === "products" &&
                    canSeeCost &&
                    p.purchasePrice !== undefined ? (
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
                    <Link
                      href={`/products/view?id=${p.id}`}
                      className="block"
                      onPointerEnter={() => prefetch("products", p.id)}
                      onFocus={() => prefetch("products", p.id)}
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </div>
              );
            })}
          </div>
          {list.isLoadingMore ? (
            <Skeleton className="mt-2 h-14 w-full" aria-busy="true" />
          ) : null}
        </div>
      )}

      <StockAdjustDialog
        product={adjusting}
        onClose={() => setAdjusting(null)}
      />
    </div>
  );
}
