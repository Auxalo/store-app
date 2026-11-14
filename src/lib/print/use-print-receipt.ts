"use client";

import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { useProfile } from "@/auth/use-auth";
import type { StoreProfile } from "@/components/settings/settings-screen";
import type { Sale, SaleItem } from "@/db/local/types";
import { usePaymentMethods } from "@/hooks/use-payment-methods";
import { useSetting } from "@/hooks/use-setting";
import { useUnits } from "@/hooks/use-units";
import { useFormat } from "@/i18n/use-format";
import { usePreferences } from "@/stores/preferences";
import { receiptJob } from "./escpos";
import { printImageInWindow, printPageReceiptInWindow } from "./print-window";
import type { ReceiptModel } from "./receipt-layout";
import { buildReceiptModel } from "./receipt-model";
import { bitmapToPng, printableMm, renderReceipt } from "./render-receipt";
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
  const tu = useUnits().name;
  const tp = usePaymentMethods().name;
  const f = useFormat();
  const { storeName } = useProfile();
  const profile = useSetting<StoreProfile>("store.profile", NO_PROFILE).value;
  const footer = useSetting<string>("receipt.footer", "").value;
  const paper = usePreferences((s) => s.receiptPaper);
  const printer = usePreferences((s) => s.printer);

  /**
   * Prints through the system's print window (see print-window.ts): on receipt paper as a sharp
   * picture exactly as wide as the printable part of the roll, on A4 the receipt's page layout.
   * Never throws.
   */
  const printModelInWindow = useCallback(
    async (model: ReceiptModel): Promise<PrintResult> => {
      if (paper === "a4") {
        printPageReceiptInWindow();
        return { ok: true };
      }
      let picture: string | null = null;
      try {
        picture = bitmapToPng(await renderReceipt(model, paper));
      } catch (error) {
        console.warn("receipt picture failed", error);
      }
      if (picture)
        await printImageInWindow(
          picture,
          printableMm(paper),
          paper === "58mm" ? 58 : 80,
        );
      // No picture (very old browser): the receipt shown on the page, as before.
      else printPageReceiptInWindow();
      return { ok: true };
    },
    [paper],
  );

  /** Sends a finished receipt (any kind) the way this device was set up. */
  const printModel = useCallback(
    async (model: ReceiptModel): Promise<PrintResult> => {
      // A4 paper, "normal print" and a printer installed in Windows use the system's print window
      // (on Windows it prints with no window once the one-tap setup is done).
      if (
        paper === "a4" ||
        printer.via === "system" ||
        printer.via === "windows"
      )
        return printModelInWindow(model);
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
    [paper, printer, printModelInWindow],
  );

  const saleModel = useCallback(
    (sale: Sale, items: SaleItem[]) =>
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
    [storeName, profile, footer, t, tu, tp, f],
  );
  const run = useCallback(
    (sale: Sale, items: SaleItem[]): Promise<PrintResult> =>
      printModel(saleModel(sale, items)),
    [printModel, saleModel],
  );
  /** A sale's receipt through the print window, whatever this device is set to (the way out when direct printing fails). */
  const printInWindow = useCallback(
    (sale: Sale, items: SaleItem[]): Promise<PrintResult> =>
      printModelInWindow(saleModel(sale, items)),
    [printModelInWindow, saleModel],
  );

  /** A small sample receipt, to check the printer and the paper width. */
  const testModel = useMemo(
    () =>
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
    [storeName, profile, t, tu, tp, f],
  );
  const test = useCallback(
    (): Promise<PrintResult> => printModel(testModel),
    [printModel, testModel],
  );

  return {
    print: run,
    printModel,
    printInWindow,
    printModelInWindow,
    test,
    testModel,
  };
}
