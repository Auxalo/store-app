"use client";

import { useCallback, useState } from "react";
import { errorCode } from "@/data/errors";
import { useCommand, useDuplicateCodeCheck } from "@/data/hooks";
import { useFormat } from "@/i18n/use-format";
import { makeStoreEan13 } from "@/lib/labels/barcode";
import { clampSize, type LabelProblem } from "@/lib/labels/label-layout";
import { renderLabel } from "@/lib/labels/render-label";
import {
  MAX_LABELS_PER_PRINT,
  printLabelsInWindow,
} from "@/lib/print/print-window";
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
        const code = makeStoreEan13();
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

/** Makes the stickers and sends them to the print window; says how many went. */
export function usePrintLabels() {
  const f = useFormat();
  const size = usePreferences((s) => s.labelSize);
  const showPrice = usePreferences((s) => s.labelShowPrice);
  const [busy, setBusy] = useState(false);

  const print = useCallback(
    async (
      items: Array<{ product: LabelProduct; copies: number }>,
    ): Promise<
      | { ok: true; labels: number }
      | { ok: false; problem?: LabelProblem; name?: string }
    > => {
      setBusy(true);
      try {
        const sized = clampSize(size);
        const pictures: Array<{ src: string; copies: number }> = [];
        for (const { product, copies } of items) {
          const rendered = await renderLabel(
            {
              name: product.name,
              barcode: product.barcode,
              price: showPrice ? f.money(product.sellingPrice) : undefined,
            },
            sized,
          );
          if (!rendered.ok)
            return { ok: false, problem: rendered.problem, name: product.name };
          pictures.push({
            src: rendered.src,
            copies: Math.max(1, Math.min(copies, MAX_LABELS_PER_PRINT)),
          });
        }
        const labels = await printLabelsInWindow(pictures, sized);
        return { ok: true, labels };
      } catch (error) {
        console.warn("label print failed", error);
        return { ok: false };
      } finally {
        setBusy(false);
      }
    },
    [size, showPrice, f],
  );

  return { print, busy };
}
