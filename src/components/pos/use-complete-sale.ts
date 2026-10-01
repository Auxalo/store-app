"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { newId } from "@/lib/ids";
import { computeTotals } from "@/lib/sale-math";
import { cartTotals, useCart } from "@/stores/cart";
import { useCommands } from "@/sync/use-commands";

/**
 * Turns the cart into a sale. It saves on the device and returns at once; the network is never
 * involved in whether a sale succeeds. Shared by the "Complete sale" button and its shortcut.
 */
export function useCompleteSale(onSold: (saleId: string) => void) {
  const t = useTranslations();
  const run = useCommands();
  const cart = useCart();
  const [saving, setSaving] = useState(false);

  const totals = cartTotals(cart);
  const needsCustomer = totals.due > 0 && !cart.customerId;
  const canComplete = cart.lines.length > 0 && !needsCustomer && !saving;

  const complete = useCallback(async () => {
    const state = useCart.getState();
    if (state.lines.length === 0 || saving) return;
    const { total, due } = computeTotals(
      state.lines,
      state.discount,
      state.tendered ?? Number.MAX_SAFE_INTEGER,
    );
    if (due > 0 && !state.customerId) return;

    setSaving(true);
    try {
      const id = newId();
      await run("sale.create", {
        id,
        customerId: state.customerId,
        customerName: state.customerName,
        lines: state.lines.map(({ key: _key, ...line }) => line),
        discount: state.discount,
        tendered: state.tendered ?? total,
        paymentMethod: state.paymentMethod,
        notes: state.notes,
      });
      state.clear();
      onSold(id);
    } catch {
      toast.error(t("common.somethingWrong"));
    } finally {
      setSaving(false);
    }
  }, [run, onSold, saving, t]);

  return { complete, canComplete, saving, needsCustomer, totals };
}
