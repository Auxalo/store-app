"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { QtyField } from "@/components/shared/qty-field";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getLocalDb } from "@/db/local/db";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { returnTotal } from "@/schemas/return";
import { usePreferences } from "@/stores/preferences";
import { useCommands } from "@/sync/use-commands";

interface Candidate {
  itemIndex: number;
  productId: string;
  productName: string;
  productNameBn: string;
  unit: Parameters<typeof QtyField>[0]["unit"];
  /** Quantity that can still come back. */
  remaining: number;
  /** Refund per unit. */
  amount: number;
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
  const run = useCommands();
  const locale = usePreferences((s) => s.locale);

  const data = useLiveQuery(async () => {
    const db = getLocalDb();
    const parent =
      kind === "sale"
        ? await db.sales.get(refId)
        : await db.purchases.get(refId);
    if (!parent) return null;
    const items = (
      kind === "sale"
        ? await db.saleItems.where("saleId").equals(refId).toArray()
        : await db.purchaseItems.where("purchaseId").equals(refId).toArray()
    ).sort((a, b) => Number(a.id.split(":i")[1]) - Number(b.id.split(":i")[1]));
    const returned = new Map<number, number>();
    for (const r of await db.returns.where("refId").equals(refId).toArray()) {
      if (r.kind !== kind) continue;
      for (const l of r.lines)
        returned.set(l.itemIndex, (returned.get(l.itemIndex) ?? 0) + l.qty);
    }
    const partyId =
      kind === "sale"
        ? (parent as { customerId: string | null }).customerId
        : (parent as { supplierId: string | null }).supplierId;
    const candidates: Candidate[] = items.map((item, itemIndex) => ({
      itemIndex,
      productId: item.productId,
      productName: item.productName,
      productNameBn: item.productNameBn,
      unit: item.unit,
      remaining: item.qty - (returned.get(itemIndex) ?? 0),
      amount: "unitPrice" in item ? item.unitPrice : item.unitCost,
    }));
    return { partyId, candidates };
  }, [kind, refId]);

  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [settlement, setSettlement] = useState<"cash" | "credit">(
    kind === "sale" ? "cash" : "credit",
  );
  const [restock, setRestock] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const candidates = data?.candidates ?? [];
  const chosen = candidates.filter((c) => (qtys[c.itemIndex] ?? 0) > 0);
  const total = returnTotal(
    chosen.map((c) => ({ qty: qtys[c.itemIndex], unitPrice: c.amount })),
  );
  const needsParty = settlement === "credit" && !data?.partyId;
  const canSave = chosen.length > 0 && !needsParty && !saving;
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
        ...(kind === "sale" ? { unitPrice: c.amount } : { unitCost: c.amount }),
      }));
      if (kind === "sale")
        await run("saleReturn.create", {
          id: newId(),
          saleId: refId,
          lines: lines as never,
          settlement,
          restock,
          notes,
        });
      else
        await run("purchaseReturn.create", {
          id: newId(),
          purchaseId: refId,
          lines: lines as never,
          settlement,
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

            <Field>
              <FieldLabel>{t("returns.settlement")}</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                {(["cash", "credit"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSettlement(s)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm",
                      settlement === s
                        ? "border-primary bg-primary/10 font-medium"
                        : "hover:bg-muted",
                    )}
                    aria-pressed={settlement === s}
                    data-testid={`settle-${s}`}
                  >
                    {s === "cash"
                      ? t("returns.settleCash")
                      : kind === "sale"
                        ? t("returns.settleCredit")
                        : t("returns.settleCreditSupplier")}
                  </button>
                ))}
              </div>
              {needsParty ? (
                <p className="text-xs text-destructive">
                  {kind === "sale"
                    ? t("returns.creditNeedsCustomer")
                    : t("returns.creditNeedsSupplier")}
                </p>
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
