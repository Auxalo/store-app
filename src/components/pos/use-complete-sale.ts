"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";
import { isOffline } from "@/data/errors";
import { useCommand } from "@/data/hooks";
import { newId } from "@/lib/ids";
import { computeTotals } from "@/lib/sale-math";
import { cartTotals, useCart } from "@/stores/cart";

/**
 * Turns the cart into a sale. Offline mode saves on the device and returns at once. Online mode
 * asks the server; if that fails (no internet, a timeout) the cart is kept untouched and the next
 * try reuses the same sale and operation ids, so a sale is never rung up twice. Shared by the
 * "Complete sale" button and its shortcut.
 */
export function useCompleteSale(onSold: (saleId: string) => void) {
  const t = useTranslations();
  const run = useCommand();
  const cart = useCart();
  const saving = cart.saving;

  const totals = cartTotals(cart);
  const needsCustomer = totals.due > 0 && !cart.customerId;
  // A discount bigger than the goods would be quietly cut down to the total: say so, don't sell.
  const discountTooBig = cart.discount > totals.subtotal;
  const canComplete =
    cart.lines.length > 0 && !needsCustomer && !discountTooBig && !saving;

  const complete = useCallback(async () => {
    const state = useCart.getState();
    // Read from the store, not from this render: a second press in the same moment (a double tap,
    // the shortcut held down) must see that a sale is already on its way.
    if (state.lines.length === 0 || state.saving) return;
    const credit = state.customerId && state.useCredit ? state.credit : 0;
    const { total, due, creditUsed } = computeTotals(
      state.lines,
      state.discount,
      state.tendered ?? Number.MAX_SAFE_INTEGER,
      credit,
    );
    if (due > 0 && !state.customerId) return;
    if (state.discount > cartTotals(state).subtotal) return;

    const input = {
      customerId: state.customerId,
      customerName: state.customerName,
      lines: state.lines.map(({ key: _key, stock: _stock, ...line }) => line),
      discount: state.discount,
      // "Exactly the total" means what is left after store credit has paid its part.
      tendered: state.tendered ?? total - creditUsed,
      creditUsed,
      paymentMethod: state.paymentMethod,
      notes: state.notes,
    };
    // Same cart as the last try: same ids. A changed cart is a different sale: new ids.
    const fingerprint = JSON.stringify(input);
    const attempt =
      state.attempt?.fingerprint === fingerprint
        ? state.attempt
        : { saleId: newId(), operationId: newId(), fingerprint };
    state.setAttempt(attempt);

    state.setSaving(true);
    try {
      await run(
        "sale.create",
        { id: attempt.saleId, ...input },
        { operationId: attempt.operationId },
      );
      state.setSaving(false);
      state.clear();
      onSold(attempt.saleId);
    } catch (error) {
      toast.error(
        isOffline(error)
          ? t("common.noInternetSaving")
          : t("common.somethingWrong"),
      );
    } finally {
      state.setSaving(false);
    }
  }, [run, onSold, t]);

  return {
    complete,
    canComplete,
    saving,
    needsCustomer,
    discountTooBig,
    totals,
  };
}
