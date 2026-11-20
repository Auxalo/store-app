"use client";

import { useCallback, useState } from "react";
import { useProfile } from "@/auth/use-auth";
import type { StoreProfile } from "@/components/settings/settings-screen";
import { errorCode } from "@/data/errors";
import { useCommand, useDuplicateCodeCheck } from "@/data/hooks";
import { useSetting } from "@/hooks/use-setting";
import { useFormat } from "@/i18n/use-format";
import { makeStoreCode } from "@/lib/labels/barcode";
import {
  clampSize,
  DOTS_PER_MM,
  type LabelProblem,
} from "@/lib/labels/label-layout";
import {
  downloadPdf,
  makePdf,
  type PdfPage,
  type PdfPlacement,
} from "@/lib/labels/label-pdf";
import {
  A4,
  defaultLabelPaper,
  fitsRoll,
  isRoll,
  type LabelPaper,
  MAX_ROLL_LABELS,
  rollCell,
  rollPrintableMm,
  rollTail,
  sheetGrid,
  stack,
} from "@/lib/labels/label-sheet";
import { drawLabel, FINE_SCALE, renderLabel } from "@/lib/labels/render-label";
import { type Bitmap, PRINT_WIDTH, receiptJob } from "@/lib/print/escpos";
import {
  MAX_LABELS_PER_PRINT,
  printLabelSheetsInWindow,
  printLabelStripInWindow,
  printLabelsInWindow,
} from "@/lib/print/print-window";
import { bitmapToPng } from "@/lib/print/render-receipt";
import {
  PrintError,
  type PrintFailure,
  sendToPrinter,
} from "@/lib/print/transports";
import { usePreferences } from "@/stores/preferences";

interface LabelProduct {
  id: string;
  name: string;
  barcode: string;
  sellingPrice: number;
  version?: number;
}

/**
 * Gives a product a barcode of the shop's own (an EAN-13 starting with 2), saved like any other edit
 * to the product, so it also works at the counter. A code already used by another product is never
 * given: a new one is drawn.
 */
export function useCreateBarcode() {
  const run = useCommand();
  const checkDuplicate = useDuplicateCodeCheck();
  return useCallback(
    async (product: Pick<LabelProduct, "id" | "version">): Promise<string> => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeStoreCode();
        // Used already (checked here, and again by the server when online): draw another.
        if (await checkDuplicate("barcode", code, product.id)) continue;
        try {
          await run(
            "product.update",
            { id: product.id, changes: { barcode: code } },
            { baseVersion: product.version },
          );
          return code;
        } catch (error) {
          lastError = error;
          if (errorCode(error) !== "DUPLICATE_BARCODE") throw error;
        }
      }
      throw lastError ?? new Error("NO_FREE_CODE");
    },
    [run, checkDuplicate],
  );
}

/** What labels are printed on, on this device (see label-sheet.ts); follows the receipt printer until chosen. */
export function useLabelPaper(): LabelPaper {
  const chosen = usePreferences((s) => s.labelPaper);
  const via = usePreferences((s) => s.printer.via);
  const receiptPaper = usePreferences((s) => s.receiptPaper);
  return chosen ?? defaultLabelPaper(via, receiptPaper);
}

const NO_PROFILE: StoreProfile = { name: "", address: "", phone: "" };

/** The shop's name for the top of each label, when that is switched on (else undefined). */
export function useLabelShop(): string | undefined {
  const show = usePreferences((s) => s.labelShowShop);
  const profile = useSetting<StoreProfile>("store.profile", NO_PROFILE).value;
  const { storeName } = useProfile();
  if (!show) return undefined;
  return (profile.name || storeName || "").trim() || undefined;
}

/** Most labels one print may hold on this paper. */
export const maxLabels = (paper: LabelPaper) =>
  isRoll(paper) ? MAX_ROLL_LABELS : MAX_LABELS_PER_PRINT;

export type LabelPrintResult =
  /** `to`: straight to the receipt printer, to the computer's print window, or a downloaded PDF. */
  | { ok: true; labels: number; to: "printer" | "window" | "file" }
  | {
      ok: false;
      /** The product's code cannot be printed (which product is in `name`). */
      problem?: LabelProblem;
      name?: string;
      /** The label is wider than the roll. */
      wide?: boolean;
      /** The receipt printer could not be reached. */
      printer?: PrintFailure | "UNKNOWN";
    };

/**
 * Makes the labels and prints them on the paper chosen on this device:
 * - a sticker roll: one label per page through the print window;
 * - A4: sheets of labels through the print window;
 * - a receipt roll: the way receipts go on this device, straight to the printer when one is
 *   connected in the app (Bluetooth, USB, serial, RawBT), else through the print window (which
 *   prints with no window from the Windows one-tap icon).
 * Never throws: it says how many went and where, or why not.
 */
export function usePrintLabels() {
  const f = useFormat();
  const size = usePreferences((s) => s.labelSize);
  const showPrice = usePreferences((s) => s.labelShowPrice);
  const shop = useLabelShop();
  const printer = usePreferences((s) => s.printer);
  const paper = useLabelPaper();
  const [busy, setBusy] = useState(false);

  const print = useCallback(
    async (
      items: Array<{ product: LabelProduct; copies: number }>,
    ): Promise<LabelPrintResult> => {
      setBusy(true);
      try {
        const sized = clampSize(size);
        const max = maxLabels(paper);
        const input = (product: LabelProduct) => ({
          name: product.name,
          barcode: product.barcode,
          price: showPrice ? f.money(product.sellingPrice) : undefined,
          shop,
        });
        const count = (copies: number) => Math.max(1, Math.min(copies, max));

        if (isRoll(paper)) {
          if (!fitsRoll(sized, paper)) return { ok: false, wide: true };
          const dots = PRINT_WIDTH[paper];
          const cells: Array<{ cell: Bitmap; copies: number }> = [];
          for (const { product, copies } of items) {
            const drawn = await drawLabel(input(product), sized);
            if (!drawn.ok)
              return { ok: false, problem: drawn.problem, name: product.name };
            const cell = rollCell(drawn.bitmap, dots);
            if (!cell) return { ok: false, wide: true };
            cells.push({ cell, copies: count(copies) });
          }
          const via = printer.via;
          if (
            via === "serial" ||
            via === "ble" ||
            via === "usb" ||
            via === "rawbt"
          ) {
            const parts: Bitmap[] = [];
            for (const { cell, copies } of cells)
              for (let i = 0; i < copies && parts.length < max; i++)
                parts.push(cell);
            const labels = parts.length;
            parts.push(rollTail(dots));
            try {
              await sendToPrinter(
                { ...printer, via },
                receiptJob(stack(parts)),
              );
            } catch (error) {
              if (error instanceof PrintError)
                return { ok: false, printer: error.code };
              console.warn("label print failed", error);
              return { ok: false, printer: "UNKNOWN" };
            }
            return { ok: true, labels, to: "printer" };
          }
          const labels = await printLabelStripInWindow(
            cells.map(({ cell, copies }) => ({
              src: bitmapToPng(cell),
              copies,
            })),
            bitmapToPng(rollTail(dots)),
            rollPrintableMm(paper),
            paper === "58mm" ? 58 : 80,
            max,
          );
          return { ok: true, labels, to: "window" };
        }

        // A sticker roll gets the picture at the printer's own dots; A4 gets it drawn fine.
        const pictures: Array<{ src: string; copies: number }> = [];
        for (const { product, copies } of items) {
          const rendered = await renderLabel(
            input(product),
            sized,
            paper === "a4" ? FINE_SCALE : 1,
          );
          if (!rendered.ok)
            return { ok: false, problem: rendered.problem, name: product.name };
          pictures.push({ src: rendered.src, copies: count(copies) });
        }
        const labels =
          paper === "a4"
            ? await printLabelSheetsInWindow(pictures, sized, {
                ...sheetGrid(sized),
                widthMm: A4.w,
                edgeMm: A4.edge,
              })
            : await printLabelsInWindow(pictures, sized);
        return { ok: true, labels, to: "window" };
      } catch (error) {
        console.warn("label print failed", error);
        return { ok: false };
      } finally {
        setBusy(false);
      }
    },
    [size, showPrice, shop, f, paper, printer],
  );

  /**
   * The same labels laid out as they would print on the chosen paper, as a PDF download: one label
   * per page for a sticker roll, full A4 sheets with cut lines, or a long strip as wide as the roll.
   */
  const download = useCallback(
    async (
      items: Array<{ product: LabelProduct; copies: number }>,
    ): Promise<LabelPrintResult> => {
      setBusy(true);
      try {
        const sized = clampSize(size);
        const max = maxLabels(paper);
        const images: Bitmap[] = [];
        const order: number[] = [];
        for (const { product, copies } of items) {
          const drawn = await drawLabel(
            {
              name: product.name,
              barcode: product.barcode,
              price: showPrice ? f.money(product.sellingPrice) : undefined,
              shop,
            },
            sized,
            isRoll(paper) ? 1 : FINE_SCALE,
          );
          if (!drawn.ok)
            return { ok: false, problem: drawn.problem, name: product.name };
          let picture = drawn.bitmap;
          if (isRoll(paper)) {
            const cell = fitsRoll(sized, paper)
              ? rollCell(picture, PRINT_WIDTH[paper])
              : null;
            if (!cell) return { ok: false, wide: true };
            picture = cell;
          }
          images.push(picture);
          const n = Math.max(1, Math.min(copies, max));
          for (let i = 0; i < n && order.length < max; i++)
            order.push(images.length - 1);
        }

        const pages: PdfPage[] = [];
        if (isRoll(paper)) {
          const dots = PRINT_WIDTH[paper];
          const paperMm = paper === "58mm" ? 58 : 80;
          const wide = rollPrintableMm(paper);
          const left = (paperMm - wide) / 2;
          const tail = images.push(rollTail(dots)) - 1;
          const tallMm = (i: number) => images[i].height / DOTS_PER_MM;
          // A long strip, in pages of at most 100 labels (PDF readers stop at about 5 m a page).
          for (let start = 0; start < order.length; start += 100) {
            const place: PdfPlacement[] = [];
            let y = 0;
            for (const image of [...order.slice(start, start + 100), tail]) {
              place.push({ image, x: left, y, w: wide, h: tallMm(image) });
              y += tallMm(image);
            }
            pages.push({ w: paperMm, h: y, place });
          }
        } else if (paper === "a4") {
          const grid = sheetGrid(sized);
          const left = (A4.w - grid.cols * sized.w) / 2;
          for (let start = 0; start < order.length; start += grid.perPage) {
            const page: PdfPage = { w: A4.w, h: A4.h, place: [], cuts: [] };
            order.slice(start, start + grid.perPage).forEach((image, i) => {
              const box = {
                x: left + (i % grid.cols) * sized.w,
                y: A4.edge + Math.floor(i / grid.cols) * sized.h,
                w: sized.w,
                h: sized.h,
              };
              page.place.push({ image, ...box });
              page.cuts?.push(box);
            });
            pages.push(page);
          }
        } else
          for (const image of order)
            pages.push({
              w: sized.w,
              h: sized.h,
              place: [{ image, x: 0, y: 0, w: sized.w, h: sized.h }],
            });

        const bytes = await makePdf(images, pages);
        const day = new Date().toISOString().slice(0, 10);
        const name =
          items.length === 1
            ? items[0].product.name.replace(/[\\/:*?"<>|]+/g, " ").trim()
            : "";
        downloadPdf(bytes, `${name ? `${name} ` : ""}labels ${day}.pdf`);
        return { ok: true, labels: order.length, to: "file" };
      } catch (error) {
        console.warn("label pdf failed", error);
        return { ok: false };
      } finally {
        setBusy(false);
      }
    },
    [size, showPrice, shop, f, paper],
  );

  return { print, download, busy, paper };
}
