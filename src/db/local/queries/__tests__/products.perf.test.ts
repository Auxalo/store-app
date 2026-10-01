import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { searchWords } from "@/lib/search";
import { StoreDB } from "../../db";
import type { Product } from "../../types";
import { findProductByCode, searchProducts } from "../products";

// Timing tests live apart from the correctness tests so they can run alone (`pnpm test:perf`):
// run in parallel with database-heavy suites the numbers are noise.
let db: StoreDB;

beforeEach(() => {
  db = new StoreDB(`perf-${randomUUID()}`);
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

describe("speed with a big catalogue", () => {
  it("searches 20,000 products quickly (fake IndexedDB is far slower than a real browser)", async () => {
    const words = [
      "Milk",
      "Rice",
      "Soap",
      "Tea",
      "Sugar",
      "Salt",
      "Oil",
      "Biscuit",
      "Noodles",
      "Juice",
    ];
    const bn = [
      "দুধ",
      "চাল",
      "সাবান",
      "চা",
      "চিনি",
      "লবণ",
      "তেল",
      "বিস্কুট",
      "নুডলস",
      "জুস",
    ];
    const batch: Product[] = [];
    for (let i = 0; i < 20_000; i++) {
      const k = i % words.length;
      batch.push(
        make({
          name: `${words[k]} ${i}`,
          nameBn: `${bn[k]} ${i}`,
          sku: `SKU-${i}`,
          barcode: String(8_900_000_000_000 + i),
        }),
      );
    }
    await db.products.bulkAdd(batch);
    expect(await db.products.count()).toBe(20_000);

    // Best of three, so a busy machine does not fail the test; a full-table scan would be far slower.
    const timed = async (label: string, run: () => Promise<unknown>) => {
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 3; i++) {
        const start = performance.now();
        await run();
        best = Math.min(best, performance.now() - start);
      }
      return { label, ms: best };
    };

    const results = [
      await timed("word prefix", () => searchProducts(db, { query: "suga" })),
      await timed("bangla", () => searchProducts(db, { query: "চিনি ১২৩" })),
      await timed("barcode", () =>
        searchProducts(db, { query: "8900000012345" }),
      ),
      await timed("sku", () => findProductByCode(db, "SKU-4321")),
      await timed("empty list", () => searchProducts(db, {})),
    ];
    for (const { label, ms } of results)
      expect(ms, `${label} took ${Math.round(ms)}ms`).toBeLessThan(600);

    const hit = await searchProducts(db, { query: "8900000012345" });
    expect(hit[0]?.barcode).toBe("8900000012345");
    expect(
      (await searchProducts(db, { query: "চিনি ১২৩" })).map((p) => p.name),
    ).toContain("Sugar 1234");
  }, 120_000);
});
