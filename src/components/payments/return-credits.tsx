"use client";

import { Ban, Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { VoidReturnDialog } from "@/components/returns/void-return-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ListError, LoadMore } from "@/components/shared/load-more";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useList } from "@/data/hooks";
import type { ReturnDoc } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { returnSplit } from "@/lib/refund";
import { cn } from "@/lib/utils";

/**
 * Money a return took off what someone owed (or kept on their account). It is not a payment (no
 * money changed hands) but it moves a balance like one, so it is listed with the payments. Its
 * cancel button cancels the whole return, so goods, balance and cash stay in step.
 */
export function ReturnCredits({
  kind,
  from,
  to,
}: {
  kind: "all" | "sale" | "purchase";
  from?: string;
  to?: string;
}) {
  const t = useTranslations();
  const f = useFormat();
  const { role } = useProfile();
  const [cancelling, setCancelling] = useState<ReturnDoc | null>(null);
  const list = useList("returns", {
    kind,
    from,
    to,
    creditOnly: true,
    sort: "newest",
  });
  const canCancel = can(role, "sale.void");

  if (list.status === "error") return <ListError onRetry={list.refetch} />;
  if (list.status === "loading" && list.items.length === 0)
    return <Skeleton className="h-24 w-full" />;
  if (list.items.length === 0)
    return (
      <EmptyState
        icon={Undo2}
        title={t("payments.creditsEmpty")}
        testId="return-credits-empty"
      />
    );

  return (
    <>
      <ul className="flex flex-col gap-2" data-testid="return-credits">
        {(list.items as unknown as ReturnDoc[]).map((r) => {
          const { credited } = returnSplit(r);
          const voided = r.status === "voided";
          const sale = r.kind === "sale";
          return (
            <li
              key={r.id}
              className="flex items-start gap-3 rounded-xl border bg-card p-3"
              data-testid="return-credit-row"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {r.partyName || "—"}
                  {voided ? (
                    <Badge variant="destructive" className="ms-2">
                      {t("returns.voided")}
                    </Badge>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {sale ? t("returns.splitOff") : t("returns.splitOffSupplier")}{" "}
                  ·{" "}
                  <Link
                    href={
                      sale
                        ? `/sales/view?id=${r.refId}`
                        : `/purchases/view?id=${r.refId}`
                    }
                    className="underline-offset-4 hover:underline"
                  >
                    {r.returnNo} ({r.refNo})
                  </Link>
                </span>
                <span className="block text-xs text-muted-foreground">
                  {f.dateTime(r.createdAt)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={cn(
                    "font-semibold",
                    voided && "line-through text-muted-foreground",
                  )}
                >
                  {f.money(credited)}
                </span>
                {canCancel && !voided ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive"
                    onClick={() => setCancelling(r)}
                    data-testid="cancel-return"
                  >
                    <Ban aria-hidden />
                    {t("returns.cancelReturn")}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
      <LoadMore list={list} />
      <VoidReturnDialog ret={cancelling} onClose={() => setCancelling(null)} />
    </>
  );
}
