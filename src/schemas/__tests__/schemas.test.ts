import { describe, expect, it } from "vitest";
import { COMMANDS } from "@/commands/definitions";
import { categoryChangesSchema } from "../category";
import {
  productChangesSchema,
  productCreateInput,
  productUpdateInput,
  stockAdjustInput,
} from "../product";

describe("edit payloads carry only what changed", () => {
  // Regression: .partial() on a schema with .default() values filled every untouched field with its
  // default (price 0, empty names), so a one-field edit would have wiped the rest of the record.
  it("product changes are not padded with defaults", () => {
    expect(productChangesSchema.parse({ description: "Cold" })).toEqual({
      description: "Cold",
    });
    expect(productChangesSchema.parse({ sellingPrice: 5500 })).toEqual({
      sellingPrice: 5500,
    });
  });

  it("product update input stays minimal end to end", () => {
    const parsed = COMMANDS["product.update"].input.parse({
      id: "p1",
      changes: { isActive: false },
    });
    expect(parsed).toEqual({ id: "p1", changes: { isActive: false } });
    expect(
      productUpdateInput.parse({ id: "p1", changes: { name: "x" } }).changes,
    ).toEqual({ name: "x" });
  });

  it("category changes are not padded with defaults", () => {
    expect(categoryChangesSchema.parse({ nameBn: "দুধ" })).toEqual({
      nameBn: "দুধ",
    });
  });

  it("an edit with no changes is rejected", () => {
    expect(productChangesSchema.safeParse({}).success).toBe(false);
    expect(categoryChangesSchema.safeParse({}).success).toBe(false);
  });
});

describe("product create input", () => {
  it("fills sensible defaults for a minimal product", () => {
    const parsed = productCreateInput.parse({
      id: "p1",
      name: "Rice",
      openingMovementId: "m1",
    });
    expect(parsed).toMatchObject({
      nameBn: "",
      unit: "pcs",
      purchasePrice: 0,
      sellingPrice: 0,
      openingStock: 0,
      isActive: true,
      categoryId: null,
    });
  });

  it("rejects fractional poisha, negative prices and unknown units", () => {
    const base = { id: "p1", name: "Rice", openingMovementId: "m1" };
    expect(
      productCreateInput.safeParse({ ...base, sellingPrice: 10.5 }).success,
    ).toBe(false);
    expect(
      productCreateInput.safeParse({ ...base, sellingPrice: -1 }).success,
    ).toBe(false);
    expect(
      productCreateInput.safeParse({ ...base, unit: "parsec" }).success,
    ).toBe(false);
    expect(productCreateInput.safeParse({ ...base, name: "  " }).success).toBe(
      false,
    );
  });
});

describe("stock adjustment input", () => {
  it("never accepts a zero movement or a non-manual type", () => {
    const base = {
      productId: "p",
      movementId: "m",
      type: "adjustment",
      note: "",
    };
    expect(stockAdjustInput.safeParse({ ...base, qtyDelta: 0 }).success).toBe(
      false,
    );
    expect(
      stockAdjustInput.safeParse({ ...base, qtyDelta: 1500 }).success,
    ).toBe(true);
    expect(
      stockAdjustInput.safeParse({ ...base, type: "sale", qtyDelta: -1 })
        .success,
    ).toBe(false);
  });
});
