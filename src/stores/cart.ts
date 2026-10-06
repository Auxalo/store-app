"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getLocalDb } from "@/db/local/db";
import type { Product } from "@/db/local/types";
import { newId } from "@/lib/ids";
import { computeTotals } from "@/lib/sale-math";
import type { UnitCode } from "@/lib/units";
import type { PaymentMethod } from "@/schemas/sale";

export interface CartLine {
  /** Identifies the line on screen (the same product can appear on several lines). */
  key: string;
  productId: string;
  productName: string;
  productNameBn: string;
  unit: UnitCode;
  /** Milli-units. */
  qty: number;
  listPrice: number;
  unitPrice: number;
  unitCost: number;
  discount: number;
  /** Milli-units in stock when the line was added: only for the "not enough in stock" warning. */
  stock?: number;
}

interface CartContents {
  lines: CartLine[];
  customerId: string | null;
  customerName: string;
  /** Cart-level discount in poisha. */
  discount: number;
  /** Money received, or null for "exactly the total". */
  tendered: number | null;
  paymentMethod: PaymentMethod;
  notes: string;
}

export interface HeldCart extends CartContents {
  id: string;
  heldAt: string;
}

/** The ids of a sale being sent. A retry of the same cart reuses them, so it is never rung up twice. */
export interface SaleAttempt {
  saleId: string;
  operationId: string;
  fingerprint: string;
}

interface CartState extends CartContents {
  held: HeldCart[];
  attempt: SaleAttempt | null;
  /**
   * A sale is on its way to the server or the database. Until it is done the cart cannot change
   * (hold, remove, edit...): a change in that moment would be wiped, or leave a copy of the sold
   * items on hold. Not saved with the cart.
   */
  saving: boolean;
  setSaving: (saving: boolean) => void;
  setAttempt: (attempt: SaleAttempt | null) => void;
  addProduct: (product: Product, qty?: number) => void;
  setQty: (key: string, qty: number) => void;
  setUnitPrice: (key: string, unitPrice: number) => void;
  removeLine: (key: string) => void;
  setCustomer: (id: string | null, name: string) => void;
  setDiscount: (discount: number) => void;
  setTendered: (tendered: number | null) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setNotes: (notes: string) => void;
  clear: () => void;
  hold: () => void;
  resume: (id: string) => void;
  discardHeld: (id: string) => void;
}

const empty: CartContents = {
  lines: [],
  customerId: null,
  customerName: "",
  discount: 0,
  tendered: null,
  paymentMethod: "cash",
  notes: "",
};

const contentsOf = (s: CartContents): CartContents => ({
  lines: s.lines,
  customerId: s.customerId,
  customerName: s.customerName,
  discount: s.discount,
  tendered: s.tendered,
  paymentMethod: s.paymentMethod,
  notes: s.notes,
});

/** The cart is kept in the device database, so a reload, crash or power cut never loses it. */
const dexieStorage = createJSONStorage(() => ({
  getItem: async (name: string) => {
    const row = await getLocalDb().drafts.get(name);
    return (row?.value as string | undefined) ?? null;
  },
  setItem: async (name: string, value: string) => {
    await getLocalDb().drafts.put({ key: name, value });
  },
  removeItem: async (name: string) => {
    await getLocalDb().drafts.delete(name);
  },
}));

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      ...empty,
      held: [],
      attempt: null,
      saving: false,
      setSaving: (saving) => set({ saving }),
      setAttempt: (attempt) => set({ attempt }),

      addProduct: (product, qty = 1000) =>
        set((s) => {
          if (s.saving) return {};
          // Tapping the same product again adds to its line (unless that line was repriced).
          const same = s.lines.find(
            (l) =>
              l.productId === product.id &&
              l.unitPrice === product.sellingPrice &&
              l.discount === 0,
          );
          if (same)
            return {
              lines: s.lines.map((l) =>
                l === same ? { ...l, qty: l.qty + qty } : l,
              ),
            };
          const line: CartLine = {
            key: newId(),
            productId: product.id,
            productName: product.name,
            productNameBn: product.nameBn,
            unit: product.unit,
            qty,
            listPrice: product.sellingPrice,
            unitPrice: product.sellingPrice,
            // A cashier is not sent purchase prices; the server fills the cost in from its own records.
            unitCost: product.purchasePrice ?? 0,
            discount: 0,
            stock: product.stock,
          };
          return { lines: [...s.lines, line] };
        }),

      setQty: (key, qty) =>
        set((s) =>
          s.saving
            ? {}
            : {
                lines: s.lines.map((l) => (l.key === key ? { ...l, qty } : l)),
              },
        ),
      setUnitPrice: (key, unitPrice) =>
        set((s) =>
          s.saving
            ? {}
            : {
                lines: s.lines.map((l) =>
                  l.key === key ? { ...l, unitPrice } : l,
                ),
              },
        ),
      removeLine: (key) =>
        set((s) =>
          s.saving ? {} : { lines: s.lines.filter((l) => l.key !== key) },
        ),
      setCustomer: (customerId, customerName) =>
        set((s) => (s.saving ? {} : { customerId, customerName })),
      setDiscount: (discount) => set((s) => (s.saving ? {} : { discount })),
      setTendered: (tendered) => set((s) => (s.saving ? {} : { tendered })),
      setPaymentMethod: (paymentMethod) =>
        set((s) => (s.saving ? {} : { paymentMethod })),
      setNotes: (notes) => set((s) => (s.saving ? {} : { notes })),
      clear: () => set((s) => (s.saving ? {} : { ...empty, attempt: null })),

      hold: () => {
        const s = get();
        if (s.saving || s.lines.length === 0) return;
        set({
          held: [
            ...s.held,
            { ...contentsOf(s), id: newId(), heldAt: new Date().toISOString() },
          ],
          ...empty,
        });
      },
      resume: (id) =>
        set((s) => {
          const target = s.held.find((h) => h.id === id);
          if (!target || s.saving) return {};
          // The cart being replaced goes on hold rather than being lost.
          const parked =
            s.lines.length > 0
              ? [
                  {
                    ...contentsOf(s),
                    id: newId(),
                    heldAt: new Date().toISOString(),
                  },
                ]
              : [];
          const { id: _id, heldAt: _heldAt, ...contents } = target;
          return {
            ...contents,
            held: [...s.held.filter((h) => h.id !== id), ...parked],
          };
        }),
      discardHeld: (id) =>
        set((s) => ({ held: s.held.filter((h) => h.id !== id) })),
    }),
    {
      name: "pos-cart",
      version: 1,
      storage: dexieStorage,
      // Hydrated explicitly on the POS screen: pages are prerendered, where there is no database.
      skipHydration: true,
      partialize: (s) => ({
        ...contentsOf(s),
        held: s.held,
        attempt: s.attempt,
      }),
    },
  ),
);

/** Totals for the cart as it stands. */
export function cartTotals(s: CartContents) {
  return computeTotals(
    s.lines,
    s.discount,
    s.tendered ?? Number.MAX_SAFE_INTEGER,
  );
}
