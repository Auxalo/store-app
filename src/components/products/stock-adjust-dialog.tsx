"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCommand } from "@/data/hooks";
import type { Product } from "@/db/local/types";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { parseQty, roundToUnit } from "@/lib/qty";
import { unitDecimals } from "@/lib/units";
import { MANUAL_MOVEMENT_TYPES } from "@/schemas/product";

type Mode = "set" | "add" | "remove";
type Reason = (typeof MANUAL_MOVEMENT_TYPES)[number];

/**
 * Changes stock the safe way: the dialog works out a +/− amount and records it as a movement.
 * "Set to 50" becomes "+7" if 43 is on hand, so it adds correctly even if another device
 * sold something in the meantime (nothing ever overwrites a stock number).
 */
export function StockAdjustDialog({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const t = useTranslations();
  return (
    <ResponsiveDialog
      open={product !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t("inventory.adjustTitle")}
      description={product?.name}
    >
      {product ? (
        <Form key={product.id} product={product} onClose={onClose} />
      ) : null}
    </ResponsiveDialog>
  );
}

function Form({ product, onClose }: { product: Product; onClose: () => void }) {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommand();
  const [mode, setMode] = useState<Mode>("set");
  const [text, setText] = useState("");
  const [reason, setReason] = useState<Reason>("adjustment");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const decimals = unitDecimals(product.unit);
  const unit = t(`units.${product.unit}`);
  const amount = text.trim() === "" ? null : parseQty(text);
  const fits = amount !== null && roundToUnit(amount, decimals) === amount;
  const delta =
    amount === null
      ? 0
      : mode === "set"
        ? amount - product.stock
        : mode === "add"
          ? amount
          : -amount;
  const resulting = product.stock + delta;
  // Taking stock out cannot leave less than nothing (a typo is far likelier than a real need). Sales
  // can still take it below zero, and adding stock to bring it back is always fine.
  const belowZero = fits && delta < 0 && resulting < 0;
  const canSave = fits && delta !== 0 && !belowZero && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await run("stock.adjust", {
        productId: product.id,
        movementId: newId(),
        type: reason,
        qtyDelta: delta,
        note,
      });
      onClose();
    } catch {
      toast.error(t("common.somethingWrong"));
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <FieldGroup>
        <p className="text-sm">
          {t("inventory.currentStock")}:{" "}
          <span className="font-semibold">
            {f.qty(product.stock)} {unit}
          </span>
        </p>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="w-full">
            <TabsTrigger value="set">{t("inventory.modeSet")}</TabsTrigger>
            <TabsTrigger value="add">{t("inventory.modeAdd")}</TabsTrigger>
            <TabsTrigger value="remove">
              {t("inventory.modeRemove")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Field data-invalid={text !== "" && !fits}>
          <FieldLabel htmlFor="adjust-qty">
            {mode === "set"
              ? t("inventory.newQuantity")
              : t("inventory.quantity")}
          </FieldLabel>
          <Input
            id="adjust-qty"
            autoFocus
            inputMode="decimal"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={text !== "" && !fits}
          />
          {text !== "" && !fits ? (
            <FieldDescription className="text-destructive">
              {t("validation.tooManyDecimals")}
            </FieldDescription>
          ) : belowZero ? (
            <FieldDescription
              className="text-destructive"
              data-testid="below-zero"
            >
              {t("inventory.belowZero", {
                value: `${f.qty(product.stock)} ${unit}`,
              })}
            </FieldDescription>
          ) : fits && delta !== 0 ? (
            <FieldDescription>
              {t("inventory.resulting", {
                value: `${f.qty(resulting)} ${unit}`,
              })}
            </FieldDescription>
          ) : fits ? (
            <FieldDescription>
              {t("inventory.noChange", {
                value: `${f.qty(product.stock)} ${unit}`,
              })}
            </FieldDescription>
          ) : null}
        </Field>

        <Field>
          <FieldLabel>{t("inventory.reason")}</FieldLabel>
          <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MANUAL_MOVEMENT_TYPES.map((r) => (
                <SelectItem key={r} value={r}>
                  {t(`inventory.reasons.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor="adjust-note">{t("inventory.note")}</FieldLabel>
          <Input
            id="adjust-note"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!canSave}>
            {t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
