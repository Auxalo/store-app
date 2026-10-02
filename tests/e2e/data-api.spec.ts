import { expect, type Page, test } from "@playwright/test";
import { createProduct, indicator, signUp } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

const get = (page: Page, path: string) =>
  page.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, body: await r.json() };
  }, path);

test("the online read endpoints search, page, look up and total a real shop", async ({
  page,
  request,
}, testInfo) => {
  // No device, no data.
  expect((await request.get("/api/data/products")).status()).toBe(401);
  expect((await request.get("/api/sync/head")).status()).toBe(401);

  await signUp(page, `api${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Miniket Rice",
    nameBn: "মিনিকেট চাল",
    price: "75",
    stock: "100",
  });
  await createProduct(page, {
    name: "Nazirshail Rice",
    nameBn: "",
    price: "85",
    stock: "0",
  });
  await createProduct(page, {
    name: "Salt",
    nameBn: "লবণ",
    price: "42",
    stock: "20",
  });
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  // Searching, in English and in Bangla, sorted A-Z.
  const rice = await get(page, "/api/data/products?q=rice");
  expect(rice.status).toBe(200);
  expect(rice.body.items.map((p: { name: string }) => p.name)).toEqual([
    "Miniket Rice",
    "Nazirshail Rice",
  ]);
  const bangla = await get(
    page,
    `/api/data/products?q=${encodeURIComponent("চাল")}`,
  );
  expect(bangla.body.items).toHaveLength(1);

  // Filters and sorting.
  const out = await get(page, "/api/data/products?stock=out");
  expect(out.body.items.map((p: { name: string }) => p.name)).toEqual([
    "Nazirshail Rice",
  ]);
  const byPrice = await get(page, "/api/data/products?sort=price");
  expect(
    byPrice.body.items.map((p: { sellingPrice: number }) => p.sellingPrice),
  ).toEqual([8500, 7500, 4200]);

  // Paging walks everything once.
  const first = await get(page, "/api/data/products?limit=2");
  expect(first.body.items).toHaveLength(2);
  expect(first.body.nextCursor).toBeTruthy();
  const second = await get(
    page,
    `/api/data/products?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
  );
  expect(second.body.items).toHaveLength(1);
  expect(second.body.nextCursor).toBeNull();
  const names = [...first.body.items, ...second.body.items].map(
    (p: { name: string }) => p.name,
  );
  expect(new Set(names).size).toBe(3);

  // A page marker from one search is refused on another.
  const wrong = await get(
    page,
    `/api/data/products?stock=out&limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
  );
  expect(wrong.status).toBe(400);
  expect(wrong.body.code).toBe("BAD_CURSOR");

  // One record, a barcode/SKU lookup, totals, stock summary, and how far the shop's changes have got.
  const skuText = rice.body.items[0].sku as string;
  expect(skuText).toMatch(/\d{4}$/);
  const found = await get(
    page,
    `/api/data/products/lookup?code=${encodeURIComponent(skuText)}`,
  );
  expect(found.body.product.name).toBe("Miniket Rice");
  expect(
    (await get(page, "/api/data/products/lookup?code=nothing")).body.product,
  ).toBeNull();
  const one = await get(page, `/api/data/products/${rice.body.items[0].id}`);
  expect(one.body.record.name).toBe("Miniket Rice");
  expect(one.body.extra.stockMovements.length).toBeGreaterThan(0);
  expect((await get(page, "/api/data/products/totals")).body.totals.count).toBe(
    3,
  );
  const stock = await get(page, "/api/reports/stock");
  expect(stock.body.summary.outCount).toBe(1);
  expect(stock.body.summary.costValue).toBeGreaterThan(0);
  expect((await get(page, "/api/sync/head")).body.syncSeq).toBeGreaterThan(0);

  // Categories and settings come back whole.
  expect((await get(page, "/api/data/categories")).body.items).toEqual([]);
  expect(
    (await get(page, "/api/data/settings")).body.items.length,
  ).toBeGreaterThan(0);

  // Mistakes are clear errors, not crashes.
  expect((await get(page, "/api/data/widgets")).status).toBe(404);
  expect((await get(page, "/api/data/sales?sort=colour")).status).toBe(400);
  expect((await get(page, "/api/data/sales?from=yesterday")).status).toBe(400);
  expect((await get(page, "/api/data/products/does-not-exist")).status).toBe(
    404,
  );
});
