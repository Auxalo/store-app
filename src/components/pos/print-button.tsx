"use client";

import { Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import type { Sale, SaleItem } from "@/db/local/types";
import {
  type PrintResult,
  usePrintReceipt,
} from "@/lib/print/use-print-receipt";
import { usePreferences } from "@/stores/preferences";
import { ShareReceiptButton } from "./share-receipt-button";

/**
 * The one Print button. It prints the way this device was set up (Settings → Printer), in one tap.
 * If it cannot, it says why in plain words and offers: try again, share the receipt, or the normal
 * print window. The sale itself is never affected.
 */
export function PrintButton({
  sale,
  items,
  storeName,
  className,
  autoPrint = false,
}: {
  sale: Sale;
  items: SaleItem[];
  storeName: string;
  className?: string;
  /** Print as soon as this appears, when the device is set to print by itself. */
  autoPrint?: boolean;
}) {
  const t = useTranslations("printer");
  const { print } = usePrintReceipt();
  const wantsAuto = usePreferences((s) => s.printer.autoPrint);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<PrintResult | null>(null);
  const [autoDone, setAutoDone] = useState(false);

  async function go() {
    setBusy(true);
    setProblem(null);
    const result = await print(sale, items);
    setBusy(false);
    if (result.ok) toast.success(t("printed"));
    else setProblem(result);
  }

  // Printing by itself, once, when the receipt first appears.
  if (autoPrint && wantsAuto && !autoDone) {
    setAutoDone(true);
    queueMicrotask(() => void go());
  }

  const notSet = problem && !problem.ok && problem.code === "NOT_CHOSEN";
  return (
    <>
      <Button
        className={className}
        onClick={() => void go()}
        disabled={busy}
        data-testid="print-receipt"
      >
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Printer aria-hidden />
        )}
        {busy ? t("printing") : t("print")}
      </Button>
      <ResponsiveDialog
        open={!!problem && !problem.ok}
        onOpenChange={(open) => !open && setProblem(null)}
        title={notSet ? t("notSetTitle") : t("failTitle")}
      >
        <div className="flex flex-col gap-3" data-testid="print-problem">
          <p className="text-sm">
            {notSet
              ? t("notSetBody")
              : t(
                  `fail_${problem && !problem.ok ? problem.code : "UNKNOWN"}` as never,
                )}
          </p>
          {notSet ? null : (
            <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">
              <li>{t("checkOn")}</li>
              <li>{t("checkBluetooth")}</li>
              <li>{t("checkPaper")}</li>
            </ul>
          )}
          <div className="flex flex-col gap-2">
            {notSet ? (
              <Button asChild data-testid="print-go-setup">
                <Link href="/settings/printer">{t("setup")}</Link>
              </Button>
            ) : (
              <Button onClick={() => void go()} data-testid="print-retry">
                {t("retry")}
              </Button>
            )}
            <ShareReceiptButton
              sale={sale}
              items={items}
              storeName={storeName}
              className="w-full"
            />
            <Button
              variant="outline"
              onClick={() => {
                setProblem(null);
                window.print();
              }}
              data-testid="print-system"
            >
              {t("systemPrint")}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </>
  );
}
