"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFormat } from "@/i18n/use-format";
import { normalizeSearch } from "@/lib/search";
import type { ProductRow } from "@/reports/compute";

type SortKey = "revenue" | "qty" | "profit" | "name";
const PAGE = 50;

/**
 * Every product sold in the period (not just the best five): how much was sold, how much came
 * back, and the money. Search it, sort it, and show more as needed.
 */
export function ProductSalesList({
  rows,
  showProfit,
}: {
  rows: ProductRow[];
  showProfit: boolean;
}) {
  const t = useTranslations("reports");
  const tu = useTranslations("units");
  const f = useFormat();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("revenue");
  const [limit, setLimit] = useState(PAGE);

  const shown = useMemo(() => {
    const needle = normalizeSearch(search);
    const list = needle
      ? rows.filter((r) => normalizeSearch(r.name).includes(needle))
      : rows;
    return [...list].sort((a, b) => {
      switch (sort) {
        case "qty":
          return b.soldQty - a.soldQty;
        case "profit":
          return b.profit - a.profit;
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return b.revenue - a.revenue;
      }
    });
  }, [rows, search, sort]);

  const sorts: SortKey[] = showProfit
    ? ["revenue", "qty", "profit", "name"]
    : ["revenue", "qty", "name"];

  return (
    <div className="flex flex-col gap-2" data-testid="product-sales">
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setLimit(PAGE);
          }}
          placeholder={t("productSearch")}
          aria-label={t("productSearch")}
          className="ps-8"
          data-testid="product-search"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground" data-testid="product-count">
          {t("productsCount", { n: f.integer(shown.length) })}
        </span>
        <span className="flex-1" />
        {sorts.map((key) => (
          <Button
            key={key}
            size="sm"
            variant={sort === key ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            onClick={() => setSort(key)}
            data-testid={`product-sort-${key}`}
          >
            {t(`productSort.${key}`)}
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? t("noData") : t("productNoMatch")}
        </p>
      ) : (
        <ul className="divide-y" data-testid="product-rows">
          {shown.slice(0, limit).map((p) => (
            <li
              key={p.productId}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("qtySold")} {f.qty(p.soldQty)} {tu(p.unit)}
                  {p.returnedQty > 0
                    ? ` · ${t("qtyReturned")} ${f.qty(p.returnedQty)}`
                    : ""}
                </span>
              </span>
              <span className="shrink-0 text-end tabular-nums">
                <span className="block">{f.money(p.revenue)}</span>
                {showProfit ? (
                  <span className="block text-xs text-muted-foreground">
                    {f.money(p.profit)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {shown.length > limit ? (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          onClick={() => setLimit((l) => l + PAGE)}
          data-testid="product-more"
        >
          {t("showMore")}
        </Button>
      ) : null}
    </div>
  );
}
