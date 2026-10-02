import { expect, type Page, test } from "@playwright/test";
import {
  addCashier,
  createProduct,
  openCart,
  signUp,
  tapProduct,
} from "./helpers";

// These tests start from the app's own default for a brand-new device (online), not the suite's.
test.use({ storageState: { cookies: [], origins: [] } });

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

// The page reloads when the mode changes; a read in the middle of that is just "not yet".
const storedMode = (page: Page) =>
  page.evaluate(() => localStorage.getItem("sa.dataMode")).catch(() => null);
const modeSwitch = (page: Page) =>
  page.getByTestId("mode-card").getByTestId("work-offline-switch");

async function openSync(page: Page) {
  await page.goto("/sync");
  await expect(page.getByTestId("mode-card")).toBeVisible();
}

test("a new device starts online; Work offline downloads the shop, then works with no internet; turning it off goes back", async ({
  page,
  context,
}, testInfo) => {
  await signUp(page, `mode${Date.now()}${testInfo.project.name}`);
  expect(await storedMode(page)).toBe("online");

  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });

  // Turn Work offline on: ask, download, then the app reloads in offline mode.
  await openSync(page);
  await expect(modeSwitch(page)).toHaveAttribute("aria-checked", "false");
  await modeSwitch(page).click();
  await page.getByTestId("mode-confirm-on").click();
  await expect
    .poll(() => storedMode(page), { timeout: 60_000 })
    .toBe("offline");
  await expect(page.getByTestId("mode-card")).toBeVisible();
  await expect(modeSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("readiness")).toBeVisible();

  // No internet now: the shop is still all there.
  await context.setOffline(true);
  await page.goto("/products");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toBeVisible();
  await context.setOffline(false);

  // Turn it off again: back online, and the product is still listed (now from the server).
  await openSync(page);
  await modeSwitch(page).click();
  await page.getByTestId("mode-confirm-off").click();
  await expect.poll(() => storedMode(page), { timeout: 60_000 }).toBe("online");
  await page.goto("/products");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toBeVisible();

  // The device keeps its copy until it is asked to remove it.
  await openSync(page);
  await page.getByTestId("remove-offline-data").click();
  await page.getByTestId("remove-confirm").click();
  await expect(page.getByTestId("remove-offline-data")).toHaveCount(0);
});

test("a second tab of the device follows when the mode changes", async ({
  page,
  context,
}, testInfo) => {
  await signUp(page, `tabs${Date.now()}${testInfo.project.name}`);
  const other = await context.newPage();
  await openSync(other);
  expect(await storedMode(other)).toBe("online");

  await openSync(page);
  await modeSwitch(page).click();
  await page.getByTestId("mode-confirm-on").click();
  await expect
    .poll(() => storedMode(page), { timeout: 60_000 })
    .toBe("offline");

  // The other tab reloaded into offline mode by itself.
  await expect(modeSwitch(other)).toHaveAttribute("aria-checked", "true", {
    timeout: 30_000,
  });
});

test("a cashier can see the mode but not change it", async ({
  page,
  browser,
}, testInfo) => {
  const owner = `own${Date.now()}${testInfo.project.name}`;
  await signUp(page, owner);
  const cashierName = `cas${Date.now()}${testInfo.project.name}`;
  await addCashier(page, "সুমন", cashierName);

  const second = await browser.newContext({
    locale: "bn-BD",
    baseURL: testInfo.project.use.baseURL,
  });
  const cashierPage = await second.newPage();
  await cashierPage.goto("/login");
  await cashierPage.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(cashierName);
  await cashierPage.getByLabel("পাসওয়ার্ড").fill("password123");
  await cashierPage
    .getByRole("button", { name: "সাইন ইন", exact: true })
    .click();
  await expect(cashierPage).toHaveURL(/\/pos$/);
  await openSync(cashierPage);
  await expect(modeSwitch(cashierPage)).toBeDisabled();
  await second.close();
});

test("online with no internet: saving is paused, the cart is kept, and the same sale is rung up once when the connection returns", async ({
  page,
  context,
}, testInfo) => {
  await signUp(page, `down${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");

  await context.setOffline(true);
  await expect(page.getByTestId("online-banner")).toBeVisible();
  await cart.getByTestId("complete-sale").click();
  // Nothing was saved, and the cart is still there.
  await expect(page.locator("#print-receipt")).toHaveCount(0);
  await expect(cart.getByTestId("cart-line")).toHaveCount(1);

  // The connection returns: the same cart goes through, once.
  await context.setOffline(false);
  await expect(page.getByTestId("online-banner")).toHaveCount(0);
  await cart.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toBeVisible();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  await page.goto("/sales");
  await expect(page.getByTestId("sale-row")).toHaveCount(1);
});
