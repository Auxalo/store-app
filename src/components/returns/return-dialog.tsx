"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { QtyField } from "@/components/shared/qty-field";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useCommand, useRecord } from "@/data/hooks";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { creditShare, defaultSplit, lineNets, refundFor } from "@/lib/refund";
import { returnTotal } from "@/schemas/return";
import { usePreferences } from "@/stores/preferences";

interface Candidate {
  itemIndex: number;
  productId: string;
  productName: string;
  productNameBn: string;
  unit: Parameters<typeof QtyField>[0]["unit"];
  /** Quantity that can still come back. */
  remaining: number;
  /** Refund per unit (the price, or for a purchase the cost). */
  amount: number;
  /** A sale: what the customer really paid for the whole line, and how much of it came back before. */
  net: number;
  itemQty: number;
  returnedBefore: number;
}

type Kind = "sale" | "purchase";

/**
 * Takes goods back against an invoice. It only offers what has not been returned yet, never
 * changes the original sale or purchase, and records the return as its own document.
 */
export function ReturnDialog({
  kind,
  refId,
  open,
  onClose,
}: {
  kind: Kind;
  refId: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommand();
  const locale = usePreferences((s) => s.locale);

  // The invoice with its lines, and the returns already made against it (same shape in both modes).
  const loaded = useRecord(
    kind === "sale" ? "sales" : "purchases",
    open ? refId : null,
  );
  const data = useMemo(() => {
    const parent = loaded.record as unknown as
      | (Record<string, unknown> & { items?: Array<Record<string, unknown>> })
      | undefined;
    if (!parent) return null;
    const items = parent.items ?? [];
    const returned = new Map<number, number>();
    for (const r of loaded.extra.returns ?? []) {
      if (r.kind !== kind) continue;
      for (const l of (r.lines ?? []) as Array<{
        itemIndex: number;
        qty: number;
      }>)
        returned.set(l.itemIndex, (returned.get(l.itemIndex) ?? 0) + l.qty);
    }
    const partyId =
      kind === "sale"
        ? (parent.customerId as string | null)
        : (parent.supplierId as string | null);
    // What each line of a sale really cost, after its discount and its share of the bill discount.
    const nets =
      kind === "sale"
        ? lineNets(
            items.map((item) => ({
              qty: Number(item.qty),
              unitPrice: Number(item.unitPrice),
              discount: Number(item.discount ?? 0),
            })),
            Number(parent.discount ?? 0),
          )
        : [];
    const candidates: Candidate[] = items.map((item, itemIndex) => ({
      itemIndex,
      productId: String(item.productId),
      productName: String(item.productName),
      productNameBn: String(item.productNameBn ?? ""),
      unit: item.unit as Candidate["unit"],
      remaining: Number(item.qty) - (returned.get(itemIndex) ?? 0),
      amount: Number("unitPrice" in item ? item.unitPrice : item.unitCost),
      net: nets[itemIndex] ?? 0,
      itemQty: Number(item.qty),
      returnedBefore: returned.get(itemIndex) ?? 0,
    }));
    // What this sale paid with store credit, and how much of the sale has been refunded already.
    const refundedBefore = (loaded.extra.returns ?? [])
      .filter((r) => r.kind === kind)
      .reduce((sum, r) => sum + Number(r.total ?? 0), 0);
    return {
      partyId,
      candidates,
      creditUsed: Number(parent.creditUsed ?? 0),
      saleTotal: Number(parent.total ?? 0),
      refundedBefore,
    };
  }, [kind, loaded.record, loaded.extra]);

  const [qtys, setQtys] = useState<Record<number, number>>({});
  // The rest of the refund, after what they owe is cleared, is cash unless kept as their credit.
  const [keepAsCredit, setKeepAsCredit] = useState(false);
  const [restock, setRestock] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const candidates = data?.candidates ?? [];
  const chosen = candidates.filter((c) => (qtys[c.itemIndex] ?? 0) > 0);
  // What goes back for a line of a sale is what was really paid for it (the server works out the
  // same amount; this is what the screen shows and sends).
  const refundOf = (c: Candidate) =>
    kind === "sale"
      ? refundFor(c.net, c.itemQty, c.returnedBefore, qtys[c.itemIndex])
      : returnTotal([{ qty: qtys[c.itemIndex], unitCost: c.amount }]);
  const total = chosen.reduce((sum, c) => sum + refundOf(c), 0);
  // How the refund is settled: what the customer (or the shop, for a supplier) still owes comes off
  // first, so cash never leaves the till for money that is also still owed.
  const party = useRecord(
    kind === "sale" ? "customers" : "suppliers",
    open ? (data?.partyId ?? null) : null,
  );
  const balance = Number(
    (party.record as { balance?: number } | undefined)?.balance ?? 0,
  );
  const hasParty = !!data?.partyId;
  const share =
    kind === "sale" && data
      ? creditShare(data.creditUsed, data.saleTotal, data.refundedBefore, total)
      : 0;
  const split = defaultSplit(total, balance, {
    hasParty,
    keepAsCredit: keepAsCredit && hasParty,
    creditShare: share,
  });
  // Of what is credited: first what they owe, and the rest stays as their store credit.
  const offDue = Math.min(
    split.credited - Math.min(share, split.credited),
    Math.max(0, balance),
  );
  const keptAsCredit = split.credited - offDue;
  const canSave = chosen.length > 0 && !saving;
  const nothingLeft = data && candidates.every((c) => c.remaining <= 0);
  const name = (c: Candidate) =>
    locale === "bn" && c.productNameBn ? c.productNameBn : c.productName;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const lines = chosen.map((c) => ({
        itemIndex: c.itemIndex,
        productId: c.productId,
        productName: c.productName,
        productNameBn: c.productNameBn,
        unit: c.unit,
        qty: qtys[c.itemIndex],
        ...(kind === "sale"
          ? { unitPrice: c.amount, amount: refundOf(c) }
          : { unitCost: c.amount }),
      }));
      if (kind === "sale")
        await run("saleReturn.create", {
          id: newId(),
          saleId: refId,
          lines: lines as never,
          cashBack: split.cashBack,
          settlement: split.credited > 0 ? "credit" : "cash",
          restock,
          notes,
        });
      else
        await run("purchaseReturn.create", {
          id: newId(),
          purchaseId: refId,
          lines: lines as never,
          cashBack: split.cashBack,
          settlement: split.credited > 0 ? "credit" : "cash",
          notes,
        });
      setQtys({});
      setNotes("");
      onClose();
    } catch {
      toast.error(t("common.somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("returns.title")}
    >
      {nothingLeft ? (
        <p className="py-4 text-sm text-muted-foreground">
          {t("returns.nothingLeft")}
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            <ul className="flex flex-col gap-2" data-testid="return-lines">
              {candidates
                .filter((c) => c.remaining > 0)
                .map((c) => (
                  <li
                    key={c.itemIndex}
                    className="flex items-center gap-3 rounded-lg border p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{name(c)}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("returns.max", {
                          value: `${f.qty(c.remaining)} ${t(`units.${c.unit}`)}`,
                        })}{" "}
                        · {f.money(c.amount)}
                      </p>
                    </div>
                    <QtyField
                      aria-label={t("returns.returnQty")}
                      className="h-9 w-20 text-center"
                      value={qtys[c.itemIndex] ?? 0}
                      unit={c.unit}
                      min={0}
                      max={c.remaining}
                      onValue={(q) =>
                        setQtys((s) => ({ ...s, [c.itemIndex]: q }))
                      }
                    />
                  </li>
                ))}
            </ul>

            <Field data-testid="refund-split">
              <FieldLabel>{t("returns.settlement")}</FieldLabel>
              {hasParty ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="party-balance-now"
                >
                  {balance > 0
                    ? t(
                        kind === "sale"
                          ? "returns.balanceOwes"
                          : "returns.balanceOwesSupplier",
                        { value: f.money(balance) },
                      )
                    : balance < 0
                      ? t(
                          kind === "sale"
                            ? "returns.balanceCredit"
                            : "returns.balanceCreditSupplier",
                          { value: f.money(-balance) },
                        )
                      : t("returns.balanceClear")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t(
                    kind === "sale"
                      ? "returns.walkInCash"
                      : "returns.noSupplierCash",
                  )}
                </p>
              )}
              <ul className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-2 text-sm">
                {offDue > 0 ? (
                  <li
                    className="flex justify-between gap-2"
                    data-testid="split-off"
                  >
                    <span>
                      {t(
                        kind === "sale"
                          ? "returns.splitOff"
                          : "returns.splitOffSupplier",
                      )}
                    </span>
                    <span className="font-medium">{f.money(offDue)}</span>
                  </li>
                ) : null}
                {keptAsCredit > 0 ? (
                  <li
                    className="flex justify-between gap-2"
                    data-testid="split-kept"
                  >
                    <span>
                      {t(
                        kind === "sale"
                          ? "returns.splitKept"
                          : "returns.splitKeptSupplier",
                      )}
                    </span>
                    <span className="font-medium">{f.money(keptAsCredit)}</span>
                  </li>
                ) : null}
                <li
                  className="flex justify-between gap-2"
                  data-testid="split-cash"
                >
                  <span>
                    {t(
                      kind === "sale"
                        ? "returns.splitCash"
                        : "returns.splitCashSupplier",
                    )}
                  </span>
                  <span className="font-medium">{f.money(split.cashBack)}</span>
                </li>
              </ul>
              {hasParty ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="keep-credit"
                    checked={keepAsCredit}
                    onCheckedChange={(v) => setKeepAsCredit(v === true)}
                    data-testid="keep-credit"
                  />
                  <FieldLabel htmlFor="keep-credit">
                    {t(
                      kind === "sale"
                        ? "returns.keepAsCredit"
                        : "returns.keepAsCreditSupplier",
                    )}
                  </FieldLabel>
                </div>
              ) : null}
            </Field>

            {kind === "sale" ? (
              <Field orientation="horizontal">
                <Checkbox
                  id="restock"
                  checked={restock}
                  onCheckedChange={(v) => setRestock(v === true)}
                />
                <FieldLabel htmlFor="restock">
                  {t("returns.restock")}
                </FieldLabel>
              </Field>
            ) : null}

            <Field>
              <FieldLabel htmlFor="return-notes">
                {t("returns.notes")}
              </FieldLabel>
              <Input
                id="return-notes"
                value={notes}
                maxLength={300}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>

            <div className="flex items-center justify-between text-base font-semibold">
              <span>{t("returns.refundTotal")}</span>
              <span data-testid="refund-total">{f.money(total)}</span>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={!canSave}
                data-testid="confirm-return"
              >
                {t("returns.confirm")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      )}
    </ResponsiveDialog>
  );
}
