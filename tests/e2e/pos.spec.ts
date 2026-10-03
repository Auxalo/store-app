import { expect, test } from "@playwright/test";
import {
  createProduct,
  indicator,
  openCart,
  search,
  signIn,
  signUp,
  tapProduct,
} from "./helpers";
import { deviceOptions, E2E_MODE } from "./mode";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

test("a sale made offline: instant, receipt, stock down, then synced to a second device", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.skip(
    E2E_MODE === "online",
    "this is about the offline queue, which online mode does not use",
  );
  const username = `pos${Date.now()}${testInfo.project.name}`;
  await signUp(page, username);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await createProduct(page, {
    name: "Miniket Rice",
    nameBn: "মিনিকেট চাল",
    price: "120",
    stock: "20",
  });
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  // The shop loses internet.
  await context.setOffline(true);
  await page.goto("/pos");
  await expect(page.getByTestId("pos")).toBeVisible();

  await search(page).fill("দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await search(page).fill("চাল");
  await tapProduct(page, "মিনিকেট চাল");
  await tapProduct(page, "মিনিকেট চাল"); // tapping again adds another one
  await openCart(page);

  const cart = page.getByTestId("cart-panel");
  await expect(cart.getByTestId("cart-line")).toHaveCount(2); // milk, rice (2)
  await expect(cart.getByTestId("cart-total")).toHaveText("৳২৯০"); // 50 + 2 × 120

  // The customer hands over 500; change is 210.
  await cart.getByTestId("received-input").fill("৫০০");
  await expect(cart.getByTestId("change")).toHaveText("৳২১০");

  await cart.getByTestId("complete-sale").click();

  // The receipt appears at once, with no network.
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog"));
  const receipt = page.locator("#print-receipt");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("ফ্রেশ দুধ");
  await expect(receipt).toContainText("মিনিকেট চাল");
  await expect(receipt).toContainText("৳২৯০.০০");
  await expect(receipt).toContainText("-0001");
  await expect(dialog.first()).toBeVisible();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // The cart is empty for the next customer.
  await expect(page.getByTestId("view-cart"))
    .toBeDisabled()
    .catch(async () => {
      await expect(page.getByTestId("cart-line")).toHaveCount(0);
    });

  // Stock went down on this device straight away.
  await page.goto("/inventory");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("৯ পিস");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "মিনিকেট চাল" }),
  ).toContainText("১৮ পিস");

  // And the sale is in the history, waiting to sync.
  await page.goto("/sales");
  const row = page.getByTestId("sale-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("৳২৯০");
  await expect(indicator(page, "offline")).toContainText("১");

  // Internet returns.
  await context.setOffline(false);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });

  // A second device sees the sale and the resulting stock.
  const second = await browser.newContext(
    deviceOptions(testInfo.project.use.baseURL),
  );
  const pageB = await second.newPage();
  await signIn(pageB, username);
  await pageB.goto("/sales");
  await expect(pageB.getByTestId("sale-row")).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(pageB.getByTestId("sale-row")).toContainText("৳২৯০");
  await pageB.goto("/inventory");
  await expect(
    pageB.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("৯ পিস", { timeout: 20_000 });
  await second.close();
});

test("selling on credit adds to the customer's due; cancelling the sale puts everything back", async ({
  page,
}, testInfo) => {
  await signUp(page, `credit${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await page.goto("/pos");

  await tapProduct(page, "ফ্রেশ দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await tapProduct(page, "ফ্রেশ দুধ"); // 3 × 50 = 150
  await openCart(page);
  const cart = page.getByTestId("cart-panel");

  // Paying only 100 leaves 50 owing, which needs a customer.
  await cart.getByTestId("received-input").fill("100");
  await expect(cart.getByTestId("due")).toHaveText("৳৫০");
  await expect(cart.getByTestId("complete-sale")).toBeDisabled();
  await expect(
    cart.getByText("বাকিতে বিক্রি করতে একজন ক্রেতা বাছাই করুন।"),
  ).toBeVisible();

  // Add the customer on the spot.
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("করিম");
  await page.getByLabel("মোবাইল নম্বর").fill("01711111111");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(cart.getByTestId("customer-button")).toContainText("করিম");
  await expect(cart.getByTestId("complete-sale")).toBeEnabled();
  await cart.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toContainText("৳৫০.০০");
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // The customer now owes 50, and stock is 7.
  await page.goto("/customers");
  await expect(page.getByTestId("party-balance")).toContainText("বাকি ৳৫০");
  await page.goto("/inventory");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("৭ পিস");

  // Cancel the sale: stock and the due are restored; the sale stays on record as cancelled.
  await page.goto("/sales");
  await page.getByTestId("sale-row").click();
  await page.getByTestId("void-sale").click();
  await page.getByRole("button", { name: "বিক্রি বাতিল করুন" }).click();
  await expect(page.locator("#print-receipt")).toContainText("বাতিল");

  await page.goto("/customers");
  await expect(page.getByTestId("party-balance")).toHaveCount(0);
  await page.goto("/inventory");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("১০ পিস");
  await page.goto("/sales");
  await expect(page.getByTestId("sale-row")).toContainText("বাতিল");
});

test("a barcode typed (or scanned) into the search box adds the product", async ({
  page,
}, testInfo) => {
  await signUp(page, `scan${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Tea",
    nameBn: "চা",
    price: "30",
    stock: "5",
    barcode: "8901234567890",
  });
  await page.goto("/pos");

  await search(page).fill("8901234567890");
  await search(page).press("Enter"); // scanners finish with Enter
  await expect(search(page)).toHaveValue("");
  await openCart(page);
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-total")).toHaveText("৳৩০");
});

test("the cart survives a reload", async ({ page }, testInfo) => {
  await signUp(page, `cart${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Tea",
    nameBn: "চা",
    price: "30",
    stock: "5",
  });
  await page.goto("/pos");
  await tapProduct(page, "চা");
  await tapProduct(page, "চা");

  await page.reload();
  await openCart(page);
  await expect(page.getByTestId("cart-line")).toHaveCount(1);
  await expect(page.getByTestId("cart-total")).toHaveText("৳৬০");
});

test("tapping a product opens no keyboard on a phone, and keeps the search ready on a computer", async ({
  page,
}, testInfo) => {
  await signUp(page, `kbd${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  const searchHasFocus = await search(page).evaluate(
    (el) => el === document.activeElement,
  );
  // A phone (touch) must not get the on-screen keyboard over the list; a computer keeps the search
  // box ready for the next barcode scan.
  expect(searchHasFocus).toBe(testInfo.project.name === "desktop");
});
