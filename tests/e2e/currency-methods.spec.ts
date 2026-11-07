import { expect, type Page, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

async function newShop(page: Page, prefix: string, project: string) {
  await signUp(page, `${prefix}${Date.now()}${project}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "100",
  });
}

async function sellMilk(page: Page, method?: string) {
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  if (method) {
    await cart.getByRole("combobox", { name: "পেমেন্টের মাধ্যম" }).click();
    await page.getByRole("option", { name: method, exact: true }).click();
  }
  await cart.getByTestId("complete-sale").click();
}

test("a shop in euro sees the euro sign everywhere money is shown", async ({
  page,
}, testInfo) => {
  await newShop(page, "eur", testInfo.project.name);
  // Taka until the shop chooses.
  await page.goto("/products");
  await expect(page.getByText("৳৫০").first()).toBeVisible();

  await page.goto("/customize");
  await page.getByTestId("card-currency").click();
  await expect(page).toHaveURL(/\/customize\/currency$/);
  await page.getByTestId("currency-EUR").click();
  await expect(page.getByTestId("currency-EUR")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The counter: the total, the field labels and the receipt.
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await expect(cart.getByTestId("cart-total")).toHaveText("€৫০");
  await expect(cart.getByText("ছাড় (€)")).toBeVisible();
  await expect(cart.getByText("৳")).toHaveCount(0);
  await cart.getByTestId("complete-sale").click();
  const receipt = page.locator("#print-receipt");
  await expect(receipt).toContainText("€৫০.০০");
  await expect(receipt).not.toContainText("৳");

  // Elsewhere too, and it is still there after a reload.
  await page.goto("/products");
  await expect(page.getByText("€৫০").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("€৫০").first()).toBeVisible();
  await expect(page.getByText("৳৫০")).toHaveCount(0);
});

test("a shop hides a wallet it does not use and adds its own payment method", async ({
  page,
}, testInfo) => {
  await newShop(page, "pay", testInfo.project.name);

  // An old sale paid by bKash, made before the wallet is hidden.
  await sellMilk(page, "বিকাশ");
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  await page.goto("/customize/payments");
  await expect(page.getByTestId("method-fixed")).toContainText("ক্যাশ");
  await expect(page.getByTestId("method-fixed")).toContainText("ব্যাংক");
  await expect(page.getByTestId("method-fixed")).toContainText("কার্ড");
  await page.getByTestId("method-switch-bkash").click();
  await page.getByTestId("method-add").click();
  await page.getByTestId("method-name").fill("Revolut");
  await page.getByTestId("method-save").click();
  await expect(page.getByTestId("method-own")).toContainText("Revolut");

  // At the counter: bKash is gone, Revolut is there.
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByRole("combobox", { name: "পেমেন্টের মাধ্যম" }).click();
  await expect(page.getByRole("option", { name: "বিকাশ" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "ক্যাশ" })).toBeVisible();
  await page.getByRole("option", { name: "Revolut", exact: true }).click();
  await cart.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toContainText("Revolut");
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // Both sales show their method's name, and the Money page has a line for each.
  await page.goto("/sales");
  await expect(page.getByTestId("sale-row")).toHaveCount(2);
  await page.goto("/money");
  await expect(page.getByTestId("money-methods")).toContainText("Revolut");
  await expect(page.getByTestId("money-methods")).toContainText("বিকাশ");

  // The wallet can be switched back on.
  await page.goto("/customize/payments");
  await page.getByTestId("method-switch-bkash").click();
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  await page
    .getByTestId("cart-panel")
    .getByRole("combobox", { name: "পেমেন্টের মাধ্যম" })
    .click();
  await expect(page.getByRole("option", { name: "বিকাশ" })).toBeVisible();
});
