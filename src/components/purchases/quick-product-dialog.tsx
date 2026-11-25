"use client";

import { Loader2, PackagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { MoneyField } from "@/components/pos/money-field";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorCode } from "@/data/errors";
import { useCommand } from "@/data/hooks";
import type { Product } from "@/db/local/types";
import { useUnits } from "@/hooks/use-units";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import type { UnitCode } from "@/lib/units";

/** A typed search that is all digits (a scanned code) goes into the barcode box, anything else is the name. */
const looksLikeCode = (text: string) => /^\d{6,}$/.test(text.trim());

/**
 * Adds a product to the shop's list without leaving the purchase: the few things a purchase needs
 * (name, unit, the two prices, a barcode if it has one). Saved like any new product, with no stock:
 * the purchase itself brings the stock in. Category and the rest can be filled in later.
 */
export function QuickProductDialog({
  open,
  onOpenChange,
  initial,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What was typed in the search box, to start the name (or barcode) from. */
  initial: string;
  onCreated: (product: Product) => void;
}) {
  const t = useTranslations("purchases");
  const tc = useTranslations("common");
  const f = useFormat();
  const units = useUnits();
  const run = useCommand();
  const ids = {
    name: useId(),
    unit: useId(),
    cost: useId(),
    price: useId(),
    code: useId(),
  };

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<UnitCode>("pcs");
  const [cost, setCost] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [barcode, setBarcode] = useState("");
  const [tried, setTried] = useState(false);
  const [codeTaken, setCodeTaken] = useState(false);
  const [saving, setSaving] = useState(false);

  // Start fresh each time it opens, from what was typed.
  useEffect(() => {
    if (!open) return;
    const typed = initial.trim();
    setName(looksLikeCode(typed) ? "" : typed);
    setBarcode(looksLikeCode(typed) ? typed : "");
    setUnit("pcs");
    setCost(null);
    setPrice(null);
    setTried(false);
    setCodeTaken(false);
  }, [open, initial]);

  const nameMissing = name.trim() === "";
  const pricesMissing = !(
    cost !== null &&
    cost >= 1 &&
    price !== null &&
    price >= 1
  );

  async function save() {
    setTried(true);
    if (nameMissing || pricesMissing || saving) return;
    setSaving(true);
    setCodeTaken(false);
    const id = newId();
    const fields = {
      name: name.trim(),
      nameBn: "",
      sku: "",
      barcode: barcode.trim(),
      categoryId: null,
      unit,
      purchasePrice: cost ?? 0,
      sellingPrice: price ?? 0,
      lowStockThreshold: 0,
      description: "",
      isActive: true,
    };
    try {
      await run("product.create", {
        ...fields,
        id,
        openingStock: 0,
        openingMovementId: newId(),
      });
      toast.success(t("quickSaved", { name: fields.name }));
      onCreated({
        ...fields,
        id,
        stock: 0,
        searchWords: [],
      } as unknown as Product);
      onOpenChange(false);
    } catch (error) {
      if (errorCode(error) === "DUPLICATE_BARCODE") setCodeTaken(true);
      else toast.error(tc("somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => !saving && onOpenChange(o)}
      title={t("quickTitle")}
      description={t("quickHint")}
    >
      <form
        className="flex flex-col gap-3"
        data-testid="quick-product"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.name} className="text-sm font-medium">
            {t("quickName")}
          </label>
          <Input
            id={ids.name}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
            aria-invalid={tried && nameMissing}
            data-testid="quick-name"
          />
          {tried && nameMissing ? (
            <p className="text-xs text-destructive">{t("quickNameRequired")}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.cost} className="text-sm font-medium">
              {t("quickCost", { sym: f.symbol })}
            </label>
            <MoneyField
              id={ids.cost}
              value={cost}
              onValue={setCost}
              aria-invalid={tried && pricesMissing}
              data-testid="quick-cost"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.price} className="text-sm font-medium">
              {t("quickPrice", { sym: f.symbol })}
            </label>
            <MoneyField
              id={ids.price}
              value={price}
              onValue={setPrice}
              aria-invalid={tried && pricesMissing}
              data-testid="quick-price"
            />
          </div>
        </div>
        {tried && pricesMissing ? (
          <p className="-mt-1 text-xs text-destructive">
            {t("quickPricesRequired")}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.unit} className="text-sm font-medium">
              {t("quickUnit")}
            </label>
            <Select value={unit} onValueChange={(v) => setUnit(v as UnitCode)}>
              <SelectTrigger id={ids.unit} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {units.active.map((u) => (
                  <SelectItem key={u.code} value={u.code}>
                    {units.name(u.code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.code} className="text-sm font-medium">
              {t("quickBarcode")}
            </label>
            <Input
              id={ids.code}
              value={barcode}
              onChange={(e) => {
                setBarcode(e.target.value);
                setCodeTaken(false);
              }}
              inputMode="numeric"
              maxLength={60}
              aria-invalid={codeTaken}
              data-testid="quick-barcode"
            />
          </div>
        </div>
        {codeTaken ? (
          <p className="-mt-1 text-xs text-destructive" role="alert">
            {t("quickBarcodeTaken")}
          </p>
        ) : null}

        <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {tc("cancel")}
          </Button>
          <Button type="submit" disabled={saving} data-testid="quick-save">
            {saving ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <PackagePlus aria-hidden />
            )}
            {t("quickSave")}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
