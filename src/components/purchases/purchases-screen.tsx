"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocalDb } from "@/db/local/db";
import { useFormat } from "@/i18n/use-format";
import { useSyncStore } from "@/sync/store";

const PAGE = 50;

export function PurchasesScreen() {
  const t = useTranslations();
  const f = useFormat();
  const { role } = useProfile();
  const initialSyncDone = useSyncStore((s) => s.initialSyncDone);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query.trim().toLowerCase());
  const [limit, setLimit] = useState(PAGE);

  const purchases = useLiveQuery(async () => {
    const all = getLocalDb().purchases.orderBy("createdAt").reverse();
    if (!deferred) return all.limit(limit).toArray();
    return all
      .filter(
        (p) =>
          p.purchaseNo.toLowerCase().includes(deferred) ||
          p.invoiceRef.toLowerCase().includes(deferred) ||
          p.supplierName.toLowerCase().includes(deferred),
      )
      .limit(limit)
      .toArray();
  }, [deferred, limit]);

  if (!can(role, "purchase.manage"))
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.noAccess")}
      </p>
    );
  const rows = purchases ?? [];
  const total = rows.reduce((sum, p) => sum + p.total, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("purchases.searchPlaceholder")}
            aria-label={t("purchases.searchPlaceholder")}
            className="ps-9"
            inputMode="search"
          />
        </div>
        <Button asChild>
          <Link href="/purchases/new" data-testid="new-purchase">
            <Plus aria-hidden />
            <span className="max-sm:sr-only">{t("purchases.add")}</span>
          </Link>
        </Button>
      </div>

      {purchases !== undefined && rows.length > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t("purchases.count", {
              count: rows.length,
              n: f.integer(rows.length),
            })}
          </span>
          <span className="font-semibold text-foreground">
            {t("purchases.totalBought", { value: f.money(total) })}
          </span>
        </div>
      ) : null}

      {purchases === undefined || (!initialSyncDone && rows.length === 0) ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {deferred ? t("purchases.emptyFilter") : t("purchases.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/purchases/view?id=${p.id}`}
                className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50"
                data-testid="purchase-row"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {p.purchaseNo}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {f.date(`${p.date}T12:00:00Z`)} ·{" "}
                    {p.supplierName || t("purchases.noSupplier")}
                    {p.invoiceRef ? ` · ${p.invoiceRef}` : ""}
                  </span>
                </span>
                {p.due > 0 ? (
                  <Badge variant="secondary">
                    {t("purchases.due")} {f.money(p.due)}
                  </Badge>
                ) : null}
                <span className="shrink-0 font-semibold">
                  {f.money(p.total)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {rows.length === limit ? (
        <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
          {t("sales.all")} +
        </Button>
      ) : null}
    </div>
  );
}
