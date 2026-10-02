/**
 * The spec's "Offline Acceptance Tests" (section 60) that the other specs do not already cover:
 *   Test 1 (reload offline)        -> offline-shell.spec.ts
 *   Test 2 (offline sale)          -> pos.spec.ts
 *   Test 3 (restart, sales remain) -> here
 *   Test 4 (reconnect, no dupes)   -> here
 *   Test 5 (unstable internet)     -> here
 *   Test 6 (two devices)           -> here
 *   Test 7 (Bangla everywhere)     -> here
 */
import { expect, type Page, test } from "@playwright/test";
import {
  createProduct,
  indicator,
  openCart,
  signIn,
  signUp,
  tapProduct,
} from "./helpers";
import { deviceOptions, E2E_MODE } from "./mode";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

async function sellOne(page: Page) {
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  await page.getByTestId("received-input").fill("৫০");
  await page.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toBeVisible();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();
}

const saleRows = (page: Page) => page.getByTestId("sale-row");

test("tests 3-5: ten offline sales survive a restart, then sync once each through a flapping connection", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.skip(
    E2E_MODE === "online",
    "this is about the offline queue, which online mode does not use",
  );
  test.setTimeout(180_000);
  const username = `acc${Date.now()}${testInfo.project.name}`;
  await signUp(page, username);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "50",
  });
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  await page.goto("/pos");
  for (let i = 0; i < 10; i++) await sellOne(page);

  // "Close the browser": a fresh page in the same profile, still offline.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/sales");
  await expect(saleRows(reopened)).toHaveCount(10);
  await expect(
    indicator(reopened, "pending").or(indicator(reopened, "offline")),
  ).toBeVisible();

  // The connection comes and goes while the queue drains.
  for (let i = 0; i < 6; i++) {
    await context.setOffline(false);
    await reopened.waitForTimeout(250);
    await context.setOffline(true);
    await reopened.waitForTimeout(150);
  }
  await context.setOffline(false);
  await expect(indicator(reopened, "synced")).toBeVisible({ timeout: 60_000 });

  // A second device sees every sale exactly once, and the stock is right.
  const second = await browser.newContext(
    deviceOptions(testInfo.project.use.baseURL),
  );
  const other = await second.newPage();
  await signIn(other, username);
  await other.goto("/sales");
  await expect(saleRows(other)).toHaveCount(10, { timeout: 30_000 });
  await other.goto("/inventory");
  await expect(
    other.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("৪০ পিস");
  await second.close();
});

test("test 6: two devices sell while one is offline; both end up with every sale and the right stock", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.skip(
    E2E_MODE === "online",
    "this is about the offline queue, which online mode does not use",
  );
  test.setTimeout(180_000);
  const username = `two${Date.now()}${testInfo.project.name}`;
  await signUp(page, username);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "50",
  });
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  const second = await browser.newContext(
    deviceOptions(testInfo.project.use.baseURL),
  );
  const b = await second.newPage();
  await signIn(b, username);
  await b.goto("/inventory");
  await expect(
    b.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toBeVisible({ timeout: 30_000 });

  // A loses internet; B sells 3; A sells 2.
  await context.setOffline(true);
  await b.goto("/pos");
  for (let i = 0; i < 3; i++) await sellOne(b);
  await page.goto("/pos");
  for (let i = 0; i < 2; i++) await sellOne(page);

  await context.setOffline(false);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 60_000 });
  await expect(indicator(b, "synced")).toBeVisible({ timeout: 60_000 });

  for (const device of [page, b]) {
    await device.goto("/sales");
    await expect(saleRows(device)).toHaveCount(5, { timeout: 30_000 });
    await device.goto("/inventory");
    await expect(
      device.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
    ).toContainText("৪৫ পিস", { timeout: 30_000 });
  }
  await second.close();
});

test("test 7: Bangla names, search, receipt and reports render without trouble", async ({
  page,
}, testInfo) => {
  await signUp(page, `bn${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });

  await page.goto("/suppliers");
  await page.getByRole("button", { name: "সরবরাহকারী যোগ করুন" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("করিম ট্রেডার্স");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(
    page.getByTestId("party-row").filter({ hasText: "করিম ট্রেডার্স" }),
  ).toBeVisible();

  // Search by a Bangla word, sell on credit to a customer with a Bangla name.
  await page.goto("/pos");
  await page.getByPlaceholder("খুঁজুন বা বারকোড স্ক্যান করুন").fill("দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("received-input").fill("০");
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("রহিম উদ্দিন");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await cart.getByTestId("complete-sale").click();

  const receipt = page.locator("#print-receipt");
  await expect(receipt).toContainText("ফ্রেশ দুধ");
  await expect(receipt).toContainText("রহিম উদ্দিন");
  await expect(receipt).toContainText("৳৫০.০০");
  await expect(receipt).toContainText("ধন্যবাদ");
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // Reports and the dashboard show Bangla names and Bangla digits, and nothing overflows the screen.
  await page.goto("/reports");
  await page.getByTestId("tab-products").click();
  await expect(page.getByTestId("product-rows")).toContainText("ফ্রেশ দুধ");
  await page.getByTestId("tab-dues").click();
  await expect(page.getByText("রহিম উদ্দিন")).toBeVisible();

  for (const path of ["/dashboard", "/reports", "/pos", "/sales"]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
  }
});
