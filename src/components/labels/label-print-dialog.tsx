"use client";

import { Loader2, Printer, ScanBarcode, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { useCreateBarcode, usePrintLabels } from "@/hooks/use-labels";
import { useFormat } from "@/i18n/use-format";
import { barcodeProblem, clampSize } from "@/lib/labels/label-layout";
import { printSupport } from "@/lib/print/transports";
import { usePreferences } from "@/stores/preferences";
import {
  CopiesStepper,
  LabelPriceSwitch,
  LabelSizePicker,
} from "./label-controls";
import { LabelPreview, useProblemText } from "./label-preview";

interface LabelProduct {
  id: string;
  name: string;
  barcode: string;
  sellingPrice: number;
  version?: number;
}

const QUICK = [1, 10, 20, 50];

/**
 * "Print labels" for one product: how the sticker will look (the very picture that prints), the
 * size, how many, and Print. A product with no barcode shows a red notice with one tap to make one.
 */
export function LabelPrintDialog({
  product,
  open,
  onOpenChange,
}: {
  product: LabelProduct;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("labels");
  const f = useFormat();
  const { role } = useProfile();
  const size = clampSize(usePreferences((s) => s.labelSize));
  const showPrice = usePreferences((s) => s.labelShowPrice);
  const createBarcode = useCreateBarcode();
  const { print, busy } = usePrintLabels();
  const problemText = useProblemText();
  const [copies, setCopies] = useState(1);
  const [creating, setCreating] = useState(false);
  const [windows, setWindows] = useState(false);
  useEffect(() => setWindows(printSupport().windows), []);

  const hasCode = product.barcode.trim() !== "";
  const problem = barcodeProblem(product.barcode, size);
  const canEdit = can(role, "product.edit");
  const price = showPrice ? f.money(product.sellingPrice) : undefined;

  async function make() {
    setCreating(true);
    try {
      await createBarcode(product);
      toast.success(t("created"));
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function go() {
    const result = await print([{ product, copies }]);
    if (result.ok) toast.success(t("sent"));
    else
      toast.error(
        result.problem ? problemText(result.problem, size) : t("failed"),
      );
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("titleFor", { name: product.name })}
      wide
    >
      <div className="flex flex-col gap-4" data-testid="label-dialog">
        <LabelPreview
          name={product.name}
          barcode={product.barcode}
          price={price}
          size={size}
        />

        {!hasCode ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3"
            data-testid="label-no-barcode"
          >
            <div className="flex items-start gap-3">
              <ScanBarcode
                className="mt-0.5 size-5 shrink-0 text-destructive"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="font-medium text-destructive">
                  {t("noBarcodeTitle")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {canEdit ? t("noBarcodeBody") : t("noBarcodeAsk")}
                </p>
              </div>
            </div>
            {canEdit ? (
              <Button
                onClick={() => void make()}
                disabled={creating}
                data-testid="create-barcode"
              >
                {creating ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <ScanBarcode aria-hidden />
                )}
                {creating ? t("creating") : t("createBarcode")}
              </Button>
            ) : null}
          </div>
        ) : problem ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            data-testid="label-bad-code"
          >
            <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p>{problemText(problem, size)}</p>
          </div>
        ) : null}

        <LabelSizePicker />
        <LabelPriceSwitch />

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{t("copies")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <CopiesStepper
              value={copies}
              onChange={setCopies}
              label={t("copies")}
            />
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((n) => (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={copies === n ? "default" : "outline"}
                  onClick={() => setCopies(n)}
                >
                  {f.integer(n)}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {windows ? (
          <p
            className="rounded-lg bg-amber-500/10 p-2 text-xs"
            data-testid="label-windows-note"
          >
            {t("windowsNote")}
          </p>
        ) : null}

        <Button
          size="lg"
          disabled={!hasCode || problem !== null || busy}
          onClick={() => void go()}
          data-testid="print-labels"
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Printer aria-hidden />
          )}
          {busy
            ? t("printing")
            : t("printNow", { count: copies, n: f.integer(copies) })}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {t("checkSize")}
        </p>
      </div>
    </ResponsiveDialog>
  );
}
