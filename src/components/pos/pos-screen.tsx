"use client";

import { ShoppingCart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useMediaQuery } from "usehooks-ts";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useFormat } from "@/i18n/use-format";
import { refocusOnComputer } from "@/lib/focus";
import { useCart } from "@/stores/cart";
import { CartPanel } from "./cart-panel";
import { ProductPicker } from "./product-picker";
import { ReceiptDialog } from "./receipt-dialog";
import { useCompleteSale } from "./use-complete-sale";

/**
 * The counter. Desktop: products on the left, cart on the right. Phone: products full screen with
 * a cart bar at the bottom that opens the cart as a sheet. Keyboard: "/" or F2 search, F9 or
 * Ctrl+Enter complete, F4 customer, Esc clears the search box.
 */
export function PosScreen() {
  const t = useTranslations();
  const f = useFormat();
  const wide = useMediaQuery("(min-width: 1024px)");
  const searchRef = useRef<HTMLInputElement>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const lines = useCart((s) => s.lines);
  const heldCount = useCart((s) => s.held.length);

  // The cart lives in the device database; load it once the screen opens.
  useEffect(() => {
    void useCart.persist.rehydrate();
  }, []);

  const onSold = useCallback((saleId: string) => {
    setCartOpen(false);
    setReceiptId(saleId);
  }, []);
  const sale = useCompleteSale(onSold);

  const closeReceipt = () => {
    setReceiptId(null);
    refocusOnComputer(searchRef.current);
  };

  const opts = { enableOnFormTags: true, preventDefault: true } as const;
  useHotkeys("/, f2", () => searchRef.current?.focus(), {
    preventDefault: true,
  });
  useHotkeys("f9, ctrl+enter", () => void sale.complete(), opts);
  useHotkeys("f4", () => setCustomerOpen(true), opts);
  useHotkeys("escape", () => searchRef.current?.blur(), {
    enableOnFormTags: true,
  });

  const cartPanel = (
    <CartPanel
      sale={sale}
      onOpenCustomer={() => setCustomerOpen(true)}
      customerOpen={customerOpen}
      onCustomerOpenChange={setCustomerOpen}
    />
  );

  return (
    <div
      className="mx-auto flex w-full max-w-7xl flex-col gap-3 lg:flex-row"
      data-testid="pos"
    >
      <section className="flex h-[calc(100dvh-13.5rem)] min-h-0 flex-1 flex-col lg:h-[calc(100dvh-8.5rem)]">
        <ProductPicker searchRef={searchRef} />
        <p className="mt-2 hidden text-xs text-muted-foreground lg:block">
          {t("pos.shortcuts")}
        </p>
      </section>

      {wide ? (
        <aside className="h-[calc(100dvh-8.5rem)] w-[380px] shrink-0 rounded-xl border bg-card p-3">
          {cartPanel}
        </aside>
      ) : (
        <>
          <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 border-t bg-background p-2">
            <Button
              className="h-12 w-full justify-between text-base"
              onClick={() => setCartOpen(true)}
              disabled={lines.length === 0 && heldCount === 0}
              data-testid="view-cart"
            >
              <span className="flex items-center gap-2">
                <ShoppingCart aria-hidden />
                {t("pos.viewCart")} ·{" "}
                {t("pos.items", {
                  count: lines.length,
                  n: f.integer(lines.length),
                })}
              </span>
              <span data-testid="bar-total">{f.money(sale.totals.total)}</span>
            </Button>
          </div>
          <Drawer open={cartOpen} onOpenChange={setCartOpen}>
            <DrawerContent className="max-h-[92dvh]">
              <DrawerHeader className="sr-only">
                <DrawerTitle>{t("pos.cart")}</DrawerTitle>
                <DrawerDescription>{t("pos.cart")}</DrawerDescription>
              </DrawerHeader>
              <div className="h-[82dvh] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {cartPanel}
              </div>
            </DrawerContent>
          </Drawer>
        </>
      )}

      <ReceiptDialog saleId={receiptId} onClose={closeReceipt} />
    </div>
  );
}
