"use client";

import { Ban } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReturnDoc } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { returnSplit } from "@/lib/refund";
import { cn } from "@/lib/utils";
import { VoidReturnDialog } from "./void-return-dialog";

/**
 * The returns of one sale or purchase: when, how much, how it was settled (cash, off the due), and
 * whether it was cancelled. Owners and managers can cancel one made by mistake.
 */
export function ReturnList({
  returns,
  title,
  testId,
}: {
  returns: ReturnDoc[];
  title: string;
  testId: string;
}) {
  const t = useTranslations("returns");
  const f = useFormat();
  const { role } = useProfile();
  const [cancelling, setCancelling] = useState<ReturnDoc | null>(null);
  if (returns.length === 0) return null;
  const canCancel = can(role, "sale.void");
  const sorted = [...returns].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : 1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y" data-testid={testId}>
          {sorted.map((r) => {
            const voided = r.status === "voided";
            const split = returnSplit(r);
            const sale = r.kind === "sale";
            return (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 py-2 text-sm"
                data-testid="return-entry"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.returnNo}
                    {voided ? (
                      <Badge variant="destructive" className="ms-2">
                        {t("voided")}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.dateTime(r.createdAt)}
                    {r.notes ? ` · ${r.notes}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      split.cashBack > 0
                        ? `${sale ? t("splitCash") : t("splitCashSupplier")} ${f.money(split.cashBack)}`
                        : "",
                      split.credited > 0
                        ? `${sale ? t("splitOff") : t("splitOffSupplier")} ${f.money(split.credited)}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={cn("font-semibold", voided && "line-through")}
                  >
                    {f.money(r.total)}
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
                      {t("cancelReturn")}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
      <VoidReturnDialog ret={cancelling} onClose={() => setCancelling(null)} />
    </Card>
  );
}
