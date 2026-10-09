import { expect, type Page, test } from "@playwright/test";
import { addCashier, createProduct, indicator, signUp } from "./helpers";

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
    price: "75",
    stock: "100",
  });
  await createProduct(page, {
    name: "Nazirshail Rice",
    price: "85",
    stock: "0",
  });
  await createProduct(page, {
    name: "লবণ",
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
    `/api/data/products?q=${encodeURIComponent("লবণ")}`,
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

const post = (page: Page, path: string, body: unknown) =>
  page.evaluate(
    async ({ url, payload }) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { status: r.status, body: await r.json() };
    },
    { url: path, payload: body },
  );

test("online, a shop with PINs only lets the person who unlocked act, and only as far as their role allows", async ({
  page,
}, testInfo) => {
  await signUp(page, `pin${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await addCashier(
    page,
    "সাবিনা",
    `cash${Date.now()}${testInfo.project.name}`,
    "1234",
  );
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  const staff = await get(page, "/api/staff");
  const sabina = staff.body.staff.find(
    (s: { name: string }) => s.name === "সাবিনা",
  );
  // The owner has just typed the password, so the owner is the working person (BUG-31). Locking the
  // counter forgets that.
  expect((await get(page, "/api/data/products")).status).toBe(200);
  await post(page, "/api/actor/lock", {});
  const milk = (await get(page, "/api/data/products?q=milk")).body;

  // The shop uses PINs, so nobody acts online until they unlock.
  expect((await get(page, "/api/data/products")).status).toBe(401);
  expect((await get(page, "/api/data/products")).body.code).toBe(
    "PIN_REQUIRED",
  );
  expect(milk.code).toBe("PIN_REQUIRED");

  // A wrong PIN is refused (and counted); the right one unlocks.
  const wrong = await post(page, "/api/actor/unlock", {
    userId: sabina.id,
    pin: "9999",
  });
  expect(wrong.status).toBe(401);
  expect(wrong.body.code).toBe("WRONG_PIN");
  expect(
    (await post(page, "/api/actor/unlock", { userId: sabina.id, pin: "1234" }))
      .status,
  ).toBe(200);

  // As the cashier: can see products, but not what they cost.
  const products = await get(page, "/api/data/products?q=milk");
  expect(products.status).toBe(200);
  expect(products.body.items).toHaveLength(1);
  expect(products.body.items[0]).not.toHaveProperty("purchasePrice");
  const productId = products.body.items[0].id;

  // Can sell: the server numbers the sale and applies the cost itself. A retry changes nothing.
  const operationId = crypto.randomUUID();
  const sale = {
    id: crypto.randomUUID(),
    tendered: 5000,
    lines: [
      {
        productId,
        productName: "Fresh Milk",
        productNameBn: "",
        unit: "pcs",
        qty: 1000,
        listPrice: 5000,
        unitPrice: 5000,
        unitCost: 0,
        discount: 0,
      },
    ],
  };
  const sold = await post(page, "/api/commands", {
    operationId,
    type: "sale.create",
    input: sale,
  });
  expect(sold.status).toBe(200);
  const doc = sold.body.docs.find(
    (d: { collection: string }) => d.collection === "sales",
  ).doc;
  expect(doc.invoiceNo).toMatch(/^\d{4}-\d{5}$/);
  const retry = await post(page, "/api/commands", {
    operationId,
    type: "sale.create",
    input: sale,
  });
  expect(retry.body.status).toBe("duplicate");
  expect(
    retry.body.docs.find(
      (d: { collection: string }) => d.collection === "sales",
    ).doc.invoiceNo,
  ).toBe(doc.invoiceNo);

  // Cannot do what a cashier may not: add products, or change a price.
  const add = await post(page, "/api/commands", {
    operationId: crypto.randomUUID(),
    type: "product.create",
    input: {
      id: crypto.randomUUID(),
      name: "x",
      purchasePrice: 100,
      sellingPrice: 200,
      openingMovementId: crypto.randomUUID(),
    },
  });
  expect(add.status).toBe(403);
  const cheat = await post(page, "/api/commands", {
    operationId: crypto.randomUUID(),
    type: "sale.create",
    input: {
      ...sale,
      id: crypto.randomUUID(),
      lines: [{ ...sale.lines[0], unitPrice: 100, listPrice: 100 }],
    },
  });
  expect(cheat.status).toBe(403);

  // Locking forgets who was working.
  expect((await post(page, "/api/actor/lock", {})).status).toBe(200);
  expect((await get(page, "/api/data/products")).body.code).toBe(
    "PIN_REQUIRED",
  );
});
