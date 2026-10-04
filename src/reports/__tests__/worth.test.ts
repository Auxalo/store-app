import { describe, expect, it } from "vitest";
import { storeWorth } from "../worth";

const base = {
  stockCost: 0,
  customersOwed: 0,
  customersAdvance: 0,
  suppliersOwed: 0,
  suppliersAdvance: 0,
};

describe("store worth", () => {
  it("is stock at cost plus what customers owe minus what is owed to suppliers", () => {
    expect(
      storeWorth({
        ...base,
        stockCost: 500_000,
        customersOwed: 175_000,
        suppliersOwed: 400_000,
      }),
    ).toEqual({ customers: 175_000, suppliers: 400_000, total: 275_000 });
  });

  it("counts advances: a customer who paid ahead lowers it, a supplier paid ahead raises it", () => {
    const worth = storeWorth({
      ...base,
      stockCost: 100_000,
      customersOwed: 50_000,
      customersAdvance: 20_000,
      suppliersOwed: 30_000,
      suppliersAdvance: 10_000,
    });
    expect(worth.customers).toBe(30_000);
    expect(worth.suppliers).toBe(20_000);
    expect(worth.total).toBe(110_000);
  });

  it("can be negative (more owed to suppliers than the store holds)", () => {
    expect(
      storeWorth({ ...base, stockCost: 10_000, suppliersOwed: 60_000 }).total,
    ).toBe(-50_000);
  });

  it("is zero for an empty store", () => {
    expect(storeWorth(base).total).toBe(0);
  });
});
