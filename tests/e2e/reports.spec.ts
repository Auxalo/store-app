import { expect, test } from "@playwright/test";
import {
  createProduct,
  indicator,
  openCart,
  search,
  signUp,
  tapProduct,
} from "./helpers";
import { E2E_MODE } from "./mode";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

test("dashboard and reports show the day's sales, profit and stock, offline and from the server", async ({
  page,
  context,
}, testInfo) => {
  await signUp(page, `rep${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await createProduct(page, {
    name: "Salt",
    nameBn: "লবণ",
    price: "30",
    stock: "0",
  });

  // Two milks sold: ৳100 in, ৳80 of it is cost, so ৳20 profit.
  await page.goto("/pos");
  await search(page).fill("দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  await page.getByTestId("received-input").fill("১০০");
  await page.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toBeVisible();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  // Dashboard.
  await page.goto("/dashboard");
  await expect(page.getByTestId("stat-todaySales")).toHaveText("৳১০০");
  await expect(page.getByTestId("stat-todayProfit")).toHaveText("৳২০");
  await expect(page.getByTestId("recent-sales")).toContainText("৳১০০");
  await expect(page.getByTestId("low-stock")).toContainText("লবণ");
  await expect(page.getByTestId("low-stock")).toContainText("স্টক শেষ");
  await expect(page.getByTestId("bar-chart")).toBeVisible();
  await expect(page.getByTestId("open-pos")).toBeVisible();

  // Reports, from this device.
  await page.goto("/reports");
  await expect(page.getByTestId("r-total")).toHaveText("৳১০০");
  await expect(page.getByTestId("r-count")).toHaveText("১");
  await expect(page.getByTestId("r-net")).toHaveText("৳১০০");

  // Same numbers from the server.
  // (Online, the numbers always come from the server, so there is no picker.)
  if (E2E_MODE !== "online") {
    await page.getByTestId("source-server").click();
    await expect(page.getByTestId("r-total")).toHaveText("৳১০০");
    await expect(page.getByTestId("r-net")).toHaveText("৳১০০");
    await page.getByTestId("source-device").click();
  }

  await page.getByTestId("tab-products").click();
  await expect(page.getByTestId("product-rows")).toContainText("ফ্রেশ দুধ");
  await page.getByTestId("tab-profit").click();
  await expect(page.getByTestId("r-profit")).toHaveText("৳২০");
  await page.getByTestId("tab-stock").click();
  await expect(page.getByTestId("stock-rows")).toContainText("৮ পিস");
  await page.getByTestId("only-low").click();
  await expect(page.getByTestId("stock-rows")).toContainText("লবণ");
  await expect(page.getByTestId("stock-rows")).not.toContainText("ফ্রেশ দুধ");
  await page.getByTestId("tab-movements").click();
  await expect(page.getByTestId("movement-rows")).toContainText("বিক্রয়");

  // The shop loses internet: reports still work (offline mode only; online reports need the server).
  if (E2E_MODE === "online") return;
  await context.setOffline(true);
  await page.goto("/reports");
  await expect(page.getByTestId("r-total")).toHaveText("৳১০০");
  await page.getByTestId("tab-stock").click();
  await expect(page.getByTestId("stock-rows")).toContainText("৮ পিস");
});

test("a new store shows zeros and an empty chart, not errors", async ({
  page,
}, testInfo) => {
  await signUp(page, `rpe${Date.now()}${testInfo.project.name}`);
  await page.goto("/reports");
  await expect(page.getByTestId("r-total")).toHaveText("৳০");
  await expect(page.getByTestId("bar-chart")).toBeVisible();
});
