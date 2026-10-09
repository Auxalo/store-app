"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type RefObject,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useDebounceValue } from "usehooks-ts";
import { ListError } from "@/components/shared/load-more";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategories, useList, useProductLookup } from "@/data/hooks";
import { useDataMode } from "@/data/mode-store";
import { stockStatus } from "@/db/local/queries/products";
import type { Product } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { refocusOnComputer } from "@/lib/focus";
import { bnToEn } from "@/lib/numerals";
import { cn } from "@/lib/utils";
import { useCart } from "@/stores/cart";
import { usePreferences } from "@/stores/preferences";
import { useSyncStore } from "@/sync/store";

const ROW = 64;

/**
 * Finds products fast and adds them with one tap. A barcode scanner types the code and presses
 * Enter, which adds that exact product; typing a name and pressing Enter adds the only match.
 */
export function ProductPicker({
  searchRef,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations();
  const f = useFormat();
  const locale = usePreferences((s) => s.locale);
  const addProduct = useCart((s) => s.addProduct);
  const lines = useCart((s) => s.lines);

  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [category, setCategory] = useState("all");

  const mode = useDataMode();
  // Online, a search is a request: wait for a pause in typing instead of asking on every key.
  // (On the device it is instant, so it keeps up with the typing.)
  const [typed] = useDebounceValue(query.trim(), 150);
  const q = mode === "online" ? typed : deferred.trim();
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);
  const lookup = useProductLookup();
  const categories = useCategories()?.filter((c) => c.isActive);
  const list = useList(
    "products",
    {
      q,
      categoryId: category === "all" ? undefined : category,
      active: "active",
      sort: "name",
    },
    { pageSize: 80 },
  );
  const items = list.items;
  const { hasMore, loadMore } = list;

  const inCart = useMemo(() => {
    const totals = new Map<string, number>();
    for (const l of lines)
      totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.qty);
    return totals;
  }, [lines]);

  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 8,
  });

  // Near the bottom of what is loaded: get the next page.
  const lastIndex = virtualizer.getVirtualItems().at(-1)?.index ?? 0;
  useEffect(() => {
    if (hasMore && lastIndex >= items.length - 12) loadMore();
  }, [lastIndex, items.length, hasMore, loadMore]);

  async function onEnter() {
    const code = query.trim();
    if (!code) return;
    // A code typed with Bangla digits is the same code.
    const ascii = bnToEn(code);
    // When the list is already about this very text, the exact match is at its top: no extra request.
    const fromList =
      q === code
        ? items.find((p) => p.barcode === code || p.sku === code)
        : undefined;
    const exact =
      fromList ??
      (await lookup(code).catch(() => null)) ??
      (ascii !== code ? await lookup(ascii).catch(() => null) : null);
    // Typing a name and pressing Enter adds the only match, but only when the list on screen is
    // about this very text (it may still be showing the answer to an earlier, shorter one).
    const pick =
      exact ?? (q === code && items.length === 1 ? items[0] : undefined);
    if (!pick) {
      toast.error(t("pos.codeNotFound"));
      return;
    }
    addProduct(pick);
    setQuery("");
  }

  const name = (p: Product) => p.name;
  const chips = [
    { id: "all", label: t("products.allCategories") },
    ...(categories ?? []).map((c) => ({
      id: c.id,
      label: locale === "bn" && c.nameBn ? c.nameBn : c.name,
    })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onEnter();
            } else if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery(""); // Esc clears what was typed (the screen's hint says so)
            }
          }}
          placeholder={t("pos.searchPlaceholder")}
          aria-label={t("pos.searchPlaceholder")}
          className="h-11 ps-9 text-base"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
        />
      </div>

      {chips.length > 1 ? (
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
          role="tablist"
          aria-label={t("products.category")}
        >
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={category === c.id}
              onClick={() => setCategory(c.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm transition-colors",
                category === c.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-card hover:bg-muted",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="picker-list"
      >
        {list.status === "error" ? (
          <ListError onRetry={list.refetch} />
        ) : list.status === "loading" ||
          (items.length === 0 && mode === "offline" && !initialSyncDone) ? (
          <div className="flex flex-col gap-1.5" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("pos.noProducts")}
          </p>
        ) : (
          <div
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const p = items[row.index];
              const status = stockStatus(p);
              const count = inCart.get(p.id);
              return (
                <div
                  key={row.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                  }}
                  className="pb-1.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      addProduct(p);
                      refocusOnComputer(searchRef.current);
                    }}
                    className="flex h-full w-full items-center gap-3 rounded-xl border bg-card px-3 text-start transition-colors hover:bg-muted/50 active:bg-muted"
                    data-testid="picker-row"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {name(p)}
                      </span>
                      <span
                        className={cn(
                          "block truncate text-xs text-muted-foreground",
                          p.stock <= 0 && "text-destructive",
                        )}
                      >
                        {t("pos.inStock", {
                          value: `${f.qty(p.stock)} ${t(`units.${p.unit}`)}`,
                        })}
                      </span>
                    </span>
                    {count ? (
                      <Badge variant="secondary">×{f.qty(count)}</Badge>
                    ) : null}
                    {status !== "ok" ? (
                      <Badge
                        variant={status === "out" ? "destructive" : "secondary"}
                      >
                        {status === "out"
                          ? t("products.outBadge")
                          : t("products.lowBadge")}
                      </Badge>
                    ) : null}
                    <span className="shrink-0 font-semibold">
                      {f.money(p.sellingPrice)}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
