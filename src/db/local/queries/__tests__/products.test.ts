import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { searchWords } from "@/lib/search";
import { StoreDB } from "../../db";
import type { Product } from "../../types";
import {
  findDuplicateCode,
  findProductByCode,
  searchProducts,
  stockStatus,
} from "../products";

let db: StoreDB;

beforeEach(() => {
  db = new StoreDB(`search-${randomUUID()}`);
});

function make(over: Partial<Product> & { name: string }): Product {
  const p = {
    id: randomUUID(),
    storeId: "s",
    nameBn: "",
    sku: "",
    barcode: "",
    categoryId: null,
    unit: "pcs",
    purchasePrice: 0,
    sellingPrice: 0,
    stock: 10_000,
    lowStockThreshold: 0,
    description: "",
    isActive: true,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
    createdBy: "u",
    deviceId: "d",
    version: 1,
    deletedAt: null,
    searchWords: [],
    ...over,
  } as Product;
  p.searchWords = searchWords(p.name, p.nameBn, p.sku, p.barcode);
  return p;
}

const names = async (query: string, extra = {}) =>
  (await searchProducts(db, { query, ...extra })).map((p) => p.name);

describe("search", () => {
  beforeEach(async () => {
    await db.products.bulkAdd([
      make({
        name: "Fresh Milk 500ml",
        nameBn: "ফ্রেশ দুধ ৫০০ মিলি",
        sku: "MLK-500",
        barcode: "8901234500001",
      }),
      make({
        name: "Fresh Milk 1L",
        nameBn: "ফ্রেশ দুধ ১ লিটার",
        sku: "MLK-1000",
        barcode: "8901234500002",
      }),
      make({ name: "Miniket Rice", nameBn: "মিনিকেট চাল", sku: "RICE-1" }),
      make({
        name: "Coca-Cola 500ml",
        nameBn: "কোকাকোলা",
        barcode: "5449000000996",
      }),
      make({ name: "Old Stock", isActive: false }),
      make({ name: "Deleted Milk", deletedAt: "2026-10-01T00:00:00.000Z" }),
    ]);
  });

  it("matches English names by word prefix, case-insensitively", async () => {
    expect(await names("milk")).toEqual(["Fresh Milk 1L", "Fresh Milk 500ml"]);
    expect(await names("MIL")).toEqual(["Fresh Milk 1L", "Fresh Milk 500ml"]);
    expect(await names("coca")).toEqual(["Coca-Cola 500ml"]);
  });

  it("matches Bangla names, including partial words", async () => {
    expect(await names("দুধ")).toHaveLength(2);
    expect(await names("মিনি")).toEqual(["Miniket Rice"]);
    expect(await names("কোকা")).toEqual(["Coca-Cola 500ml"]);
  });

  it("treats Bangla and English digits the same", async () => {
    expect(await names("৫০০")).toEqual(["Coca-Cola 500ml", "Fresh Milk 500ml"]);
    expect(await names("500")).toEqual(["Coca-Cola 500ml", "Fresh Milk 500ml"]);
  });

  it("requires every typed word to match", async () => {
    expect(await names("fresh 1l")).toEqual(["Fresh Milk 1L"]);
    expect(await names("ফ্রেশ লিটার")).toEqual(["Fresh Milk 1L"]);
    expect(await names("fresh rice")).toEqual([]);
  });

  it("matches SKU and barcode, with an exact code ranked first", async () => {
    expect(await names("rice-1")).toEqual(["Miniket Rice"]);
    expect(await names("MLK")).toHaveLength(2);
    expect(await names("8901234500002")).toEqual(["Fresh Milk 1L"]);
    expect((await findProductByCode(db, "5449000000996"))?.name).toBe(
      "Coca-Cola 500ml",
    );
    expect((await findProductByCode(db, "MLK-500"))?.name).toBe(
      "Fresh Milk 500ml",
    );
    expect(await findProductByCode(db, "nope")).toBeUndefined();
  });

  it("hides inactive and deleted products unless asked", async () => {
    expect(await names("old")).toEqual([]);
    expect(await names("old", { includeInactive: true })).toEqual([
      "Old Stock",
    ]);
    expect(await names("deleted", { includeInactive: true })).toEqual([]);
    expect(await findProductByCode(db, "")).toBeUndefined();
  });

  it("lists everything alphabetically when the query is empty", async () => {
    expect((await searchProducts(db, {})).map((p) => p.name)).toEqual([
      "Coca-Cola 500ml",
      "Fresh Milk 1L",
      "Fresh Milk 500ml",
      "Miniket Rice",
    ]);
    expect(await searchProducts(db, { limit: 2 })).toHaveLength(2);
  });
});

describe("filters", () => {
  it("filters by category and stock status", async () => {
    await db.products.bulkAdd([
      make({
        name: "A",
        categoryId: "c1",
        stock: 5_000,
        lowStockThreshold: 10_000,
      }),
      make({ name: "B", categoryId: "c1", stock: 0 }),
      make({ name: "C", categoryId: "c2", stock: -2_000 }),
      make({
        name: "D",
        categoryId: "c2",
        stock: 50_000,
        lowStockThreshold: 10_000,
      }),
    ]);
    expect(await names("", { categoryId: "c1" })).toEqual(["A", "B"]);
    expect(await names("", { stock: "low" })).toEqual(["A"]);
    expect(await names("", { stock: "out" })).toEqual(["B", "C"]); // zero and negative stock
    expect(await names("", { stock: "out", categoryId: "c2" })).toEqual(["C"]);
  });

  it("classifies stock", () => {
    expect(stockStatus({ stock: 0, lowStockThreshold: 5_000 })).toBe("out");
    expect(stockStatus({ stock: -1_000, lowStockThreshold: 0 })).toBe("out");
    expect(stockStatus({ stock: 5_000, lowStockThreshold: 5_000 })).toBe("low");
    expect(stockStatus({ stock: 5_001, lowStockThreshold: 5_000 })).toBe("ok");
    expect(stockStatus({ stock: 1_000, lowStockThreshold: 0 })).toBe("ok");
  });

  it("finds duplicate barcodes and SKUs, ignoring the product being edited", async () => {
    const a = make({ name: "A", barcode: "111", sku: "S1" });
    await db.products.bulkAdd([
      a,
      make({
        name: "Gone",
        barcode: "222",
        deletedAt: "2026-10-01T00:00:00.000Z",
      }),
    ]);
    expect((await findDuplicateCode(db, "barcode", "111"))?.id).toBe(a.id);
    expect(await findDuplicateCode(db, "barcode", "111", a.id)).toBeUndefined();
    expect(await findDuplicateCode(db, "barcode", "222")).toBeUndefined();
    expect(await findDuplicateCode(db, "sku", "")).toBeUndefined();
  });
});
