"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocalDb } from "@/db/local/db";
import { useFormat } from "@/i18n/use-format";

/** All returns, newest first. New returns start from the sale or purchase they belong to. */
export function ReturnsScreen() {
  const t = useTranslations();
  const f = useFormat();
  const returns = useLiveQuery(
    () =>
      getLocalDb().returns.orderBy("createdAt").reverse().limit(200).toArray(),
    [],
  );
  const rows = returns ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      {returns === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
          <Undo2 className="size-8" aria-hidden />
          <p>{t("returns.empty")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={
                  r.kind === "sale"
                    ? `/sales/view?id=${r.refId}`
                    : `/purchases/view?id=${r.refId}`
                }
                className="flex items-center gap-3 rounded-xl border bg-card p-3 hover:bg-muted/50"
                data-testid="return-row"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {r.returnNo}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {f.dateTime(r.createdAt)} · {r.refNo}
                    {r.partyName ? ` · ${r.partyName}` : ""}
                  </span>
                </span>
                <Badge variant="secondary">
                  {r.kind === "sale"
                    ? t("returns.saleKind")
                    : t("returns.purchaseKind")}
                </Badge>
                <span className="shrink-0 font-semibold">
                  {f.money(r.total)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
