"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useProfile } from "@/auth/use-auth";
import type { StoreProfile } from "@/components/settings/settings-screen";
import type { Sale, SaleItem } from "@/db/local/types";
import { useSetting } from "@/hooks/use-setting";
import { useFormat } from "@/i18n/use-format";
import { usePreferences } from "@/stores/preferences";
import { receiptJob } from "./escpos";
import type { ReceiptModel } from "./receipt-layout";
import { buildReceiptModel } from "./receipt-model";
import { renderReceipt } from "./render-receipt";
import { PrintError, type PrintFailure, sendToPrinter } from "./transports";

const NO_PROFILE: StoreProfile = { name: "", address: "", phone: "" };

export type PrintResult =
  | { ok: true }
  | { ok: false; code: PrintFailure | "UNKNOWN" };

/**
 * Prints a sale's receipt the way this device was set up (Settings → Printer): straight to a
 * thermal printer as a black-and-white picture, through the RawBT app, or through the system's own
 * print window (A4 and iPhone). Never throws: it says whether it worked and, if not, why.
 */
export function usePrintReceipt() {
  const t = useTranslations("receipt");
  const tu = useTranslations("units");
  const tp = useTranslations("payment");
  const f = useFormat();
  const { storeName } = useProfile();
  const profile = useSetting<StoreProfile>("store.profile", NO_PROFILE).value;
  const footer = useSetting<string>("receipt.footer", "").value;
  const paper = usePreferences((s) => s.receiptPaper);
  const printer = usePreferences((s) => s.printer);

  /** Sends a finished receipt (any kind) the way this device was set up. */
  const printModel = useCallback(
    async (model: ReceiptModel): Promise<PrintResult> => {
      // A4 paper and "normal print" use the system's print window, as before.
      if (paper === "a4" || printer.via === "system") {
        window.print();
        return { ok: true };
      }
      if (!printer.via) return { ok: false, code: "NOT_CHOSEN" };
      try {
        const bitmap = await renderReceipt(model, paper);
        await sendToPrinter(
          { ...printer, via: printer.via },
          receiptJob(bitmap),
        );
        return { ok: true };
      } catch (error) {
        if (error instanceof PrintError) return { ok: false, code: error.code };
        console.warn("print failed", error);
        return { ok: false, code: "UNKNOWN" };
      }
    },
    [paper, printer],
  );

  const run = useCallback(
    (sale: Sale, items: SaleItem[]): Promise<PrintResult> =>
      printModel(
        buildReceiptModel({
          sale,
          items,
          storeName: storeName ?? "",
          profile,
          footer,
          t: (key, values) => t(key as never, values as never),
          tu: (unit) => tu(unit as never),
          tp: (method) => tp(method as never),
          f,
        }),
      ),
    [printModel, storeName, profile, footer, t, tu, tp, f],
  );

  /** A small sample receipt, to check the printer and the paper width. */
  const test = useCallback(
    (): Promise<PrintResult> =>
      printModel(
        buildReceiptModel({
          sale: {
            id: "test",
            invoiceNo: "TEST-0001",
            createdAt: new Date().toISOString(),
            customerName: "",
            customerId: null,
            subtotal: 15000,
            discount: 0,
            total: 15000,
            paid: 15000,
            due: 0,
            paymentMethod: "cash",
            status: "active",
          } as unknown as Sale,
          items: [
            {
              id: "t1",
              productName: t("testItem"),
              qty: 2000,
              unit: "pcs",
              unitPrice: 5000,
              discount: 0,
              lineTotal: 10000,
            },
            {
              id: "t2",
              productName: "Test 123",
              qty: 1000,
              unit: "pcs",
              unitPrice: 5000,
              discount: 0,
              lineTotal: 5000,
            },
          ] as unknown as SaleItem[],
          storeName: storeName ?? "",
          profile,
          footer: t("testFooter"),
          t: (key, values) => t(key as never, values as never),
          tu: (unit) => tu(unit as never),
          tp: (method) => tp(method as never),
          f,
        }),
      ),
    [printModel, storeName, profile, t, tu, tp, f],
  );

  return { print: run, printModel, test };
}
