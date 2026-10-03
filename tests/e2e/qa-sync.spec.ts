/**
 * QA audit, part 3: sync seen through the browser (finding S7). See docs/QA-REPORT.md.
 */
import { expect, test } from "@playwright/test";
import { createProduct, indicator, signUp } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

async function signOutOfShop(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByRole("menuitem", { name: "সাইন আউট" }).click();
  const confirm = page.getByRole("button", { name: "তবুও সাইন আউট" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  // The page re-saves the name-and-role copy of the old session just after sign-out (observed);
  // left there it makes the next visit flash "signed in" before settling. Not what this test is about.
  await page.evaluate(() => localStorage.removeItem("sa.profile"));
}

test("QA S7: a second shop signing in on the same browser syncs and sees none of the first shop's data", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;

  // Shop A has a product, and the browser is handed over.
  await signUp(page, `qaa${stamp}`, `Shop A ${stamp}`);
  await createProduct(page, {
    name: "Shop A Milk",
    nameBn: "এ দোকানের দুধ",
    price: "50",
    stock: "10",
  });
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });
  await signOutOfShop(page);

  // Shop B is created on the same browser.
  await signUp(page, `qab${stamp}`, `Shop B ${stamp}`);

  // Its device is accepted by the server: the sync chip settles instead of showing a problem.
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 40_000 });

  // And nothing of shop A is on the screen.
  await page.goto("/products");
  await expect(page.getByTestId("product-row")).toHaveCount(0);
  await expect(page.getByText("Shop A Milk")).toHaveCount(0);

  // B's own work reaches B's server: add a product and see it settle.
  await createProduct(page, {
    name: "Shop B Rice",
    nameBn: "বি দোকানের চাল",
    price: "80",
    stock: "5",
  });
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 40_000 });
});
