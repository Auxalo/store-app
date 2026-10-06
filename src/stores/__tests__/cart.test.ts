import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Product } from "@/db/local/types";
import { cartTotals, useCart } from "../cart";

const product = (over: Partial<Product> = {}): Product =>
  ({
    id: "p1",
    name: "Milk",
    nameBn: "দুধ",
    unit: "pcs",
    sellingPrice: 5000,
    purchasePrice: 4000,
    stock: 100_000,
    ...over,
  }) as Product;

beforeEach(() => {
  useCart.setState({
    lines: [],
    customerId: null,
    customerName: "",
    discount: 0,
    tendered: null,
    paymentMethod: "cash",
    notes: "",
    held: [],
    attempt: null,
    saving: false,
  });
});

const state = () => useCart.getState();

describe("the POS cart", () => {
  it("tapping the same product again adds to its line", () => {
    state().addProduct(product());
    state().addProduct(product());
    expect(state().lines).toHaveLength(1);
    expect(state().lines[0].qty).toBe(2000);
  });

  it("a repriced line is kept apart from a normal one", () => {
    state().addProduct(product());
    state().setUnitPrice(state().lines[0].key, 4000);
    state().addProduct(product());
    expect(state().lines).toHaveLength(2);
  });

  it("a product without a purchase price (a cashier's view) still makes a line with a cost of zero", () => {
    state().addProduct(
      product({ purchasePrice: undefined as unknown as number }),
    );
    expect(state().lines[0].unitCost).toBe(0);
  });

  it("totals follow quantity, price, the bill discount and what was received", () => {
    state().addProduct(product(), 2000);
    state().setDiscount(1000);
    state().setTendered(5000);
    expect(cartTotals(state())).toMatchObject({
      subtotal: 10_000,
      discount: 1000,
      total: 9_000,
      paid: 5_000,
      due: 4_000,
    });
  });

  it("holding sets the cart aside and resuming brings it back, parking the cart that was there", () => {
    state().addProduct(product({ id: "a", name: "A" }));
    state().hold();
    expect(state().lines).toHaveLength(0);
    expect(state().held).toHaveLength(1);

    state().addProduct(product({ id: "b", name: "B" }));
    state().resume(state().held[0].id);
    expect(state().lines[0].productName).toBe("A");
    expect(state().held).toHaveLength(1); // B went on hold instead of being lost
    expect(state().held[0].lines[0].productName).toBe("B");
  });

  it("an empty cart cannot be held", () => {
    state().hold();
    expect(state().held).toHaveLength(0);
  });

  it("clear empties the cart and forgets the sale attempt", () => {
    state().addProduct(product());
    state().setAttempt({ saleId: "s", operationId: "o", fingerprint: "f" });
    state().clear();
    expect(state().lines).toHaveLength(0);
    expect(state().attempt).toBeNull();
  });

  describe("while a sale is saving", () => {
    beforeEach(() => {
      state().addProduct(product(), 2000);
      state().setSaving(true);
    });

    it("nothing about the cart can change", () => {
      const key = state().lines[0].key;
      state().addProduct(product({ id: "other" }));
      state().setQty(key, 9000);
      state().setUnitPrice(key, 1);
      state().removeLine(key);
      state().setDiscount(500);
      state().setTendered(1);
      state().setCustomer("c", "C");
      state().setNotes("x");
      state().setPaymentMethod("bkash");
      state().clear();
      expect(state().lines).toHaveLength(1);
      expect(state().lines[0]).toMatchObject({ qty: 2000, unitPrice: 5000 });
      expect(state()).toMatchObject({
        discount: 0,
        tendered: null,
        customerId: null,
        notes: "",
        paymentMethod: "cash",
      });
    });

    it("it cannot be put on hold, and a held cart cannot be brought in", () => {
      state().hold();
      expect(state().held).toHaveLength(0);
      expect(state().lines).toHaveLength(1);
    });

    it("everything works again afterwards", () => {
      state().setSaving(false);
      state().clear();
      expect(state().lines).toHaveLength(0);
    });
  });
});

describe("the stock a cart line remembers (for the not-enough-stock warning)", () => {
  it("is the stock when the product was added, and stays through more taps", () => {
    state().addProduct(product({ stock: 10_000 }));
    state().addProduct(product({ stock: 10_000 }));
    expect(state().lines).toHaveLength(1);
    expect(state().lines[0].stock).toBe(10_000);
    expect(state().lines[0].qty).toBe(2000);
  });
});
