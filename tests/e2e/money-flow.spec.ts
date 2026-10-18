import { expect, type Page, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

async function newShopWithMilk(page: Page, prefix: string, project: string) {
  await signUp(page, `${prefix}${Date.now()}${project}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "100",
  });
}

async function sellMilk(
  page: Page,
  count: number,
  options: { method?: string; received?: string; newCustomer?: boolean } = {},
) {
  await page.goto("/pos");
  for (let i = 0; i < count; i++) await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  if (options.newCustomer) {
    await cart.getByTestId("customer-button").click();
    await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
    await page.getByLabel("নাম", { exact: true }).fill("রহিম");
    await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  }
  if (options.method) {
    await cart.getByRole("combobox", { name: "পেমেন্টের মাধ্যম" }).click();
    await page.getByRole("option", { name: options.method }).click();
  }
  if (options.received !== undefined) {
    const received = cart.getByTestId("received-input");
    await expect(async () => {
      await received.fill(options.received as string);
      await expect(received).not.toHaveValue("", { timeout: 500 });
    }).toPass();
  }
  await page.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();
}

test("the Money page and the dashboard show what really came in and went out, by payment method", async ({
  page,
}, testInfo) => {
  await newShopWithMilk(page, "mon", testInfo.project.name);

  // In: ৳50 cash, ৳100 bKash, and ৳20 of a ৳50 bill paid on credit (so only ৳20 came in).
  await sellMilk(page, 1);
  await sellMilk(page, 2, { method: "বিকাশ" });
  await sellMilk(page, 1, { newCustomer: true, received: "20" });
  // Out: a ৳30 expense.
  await page.goto("/expenses");
  await page.getByTestId("add-expense").click();
  await page.getByTestId("expense-amount").fill("30");
  await page.getByLabel("বিবরণ").fill("চা-নাস্তা");
  await page.getByTestId("save-expense").click();
  await expect(page.getByTestId("expense-row")).toHaveCount(1);

  // The dashboard shows today's two figures, above the store worth.
  await page.goto("/dashboard");
  await expect(page.getByTestId("money-today-in-total")).toHaveText("৳১৭০");
  await expect(page.getByTestId("money-today-out-total")).toHaveText("৳৩০");

  // The Money page says the same, and where it came from.
  await page.getByTestId("money-today-in").click();
  await expect(page).toHaveURL(/\/money$/);
  await expect(page.getByTestId("money-in-total")).toHaveText("৳১৭০");
  await expect(page.getByTestId("money-out-total")).toHaveText("৳৩০");
  await expect(page.getByTestId("money-net")).toContainText("৳১৪০");
  await expect(page.getByTestId("money-in-sales")).toContainText("৳১৭০");
  await expect(page.getByTestId("money-out-expenses")).toContainText("৳৩০");
  // Cash: ৳50 + ৳20 in, ৳30 out. bKash: ৳100 in.
  await expect(page.getByTestId("money-method-cash-in")).toHaveText("৳৭০");
  await expect(page.getByTestId("money-method-cash-out")).toHaveText("৳৩০");
  await expect(page.getByTestId("money-method-bkash-in")).toHaveText("৳১০০");
  await expect(page.getByTestId("money-method-bkash-out")).toHaveText("৳০");
  // A method nobody used is not listed.
  await expect(page.getByTestId("money-method-bank")).toHaveCount(0);

  // Yesterday had nothing; "This month" has all of today.
  await page.getByRole("tab", { name: "গতকাল" }).click();
  await expect(page.getByTestId("money-empty")).toBeVisible();
  await page.getByRole("tab", { name: "এই মাস" }).click();
  await expect(page.getByTestId("money-in-total")).toHaveText("৳১৭০");
  await page.getByRole("tab", { name: "৭ দিন" }).click();
  await expect(page.getByTestId("money-in-total")).toHaveText("৳১৭০");
});

test("cancelling a sale that kept money on the account asks about that money; the money cannot be cancelled on its own first", async ({
  page,
}, testInfo) => {
  await newShopWithMilk(page, "lnk", testInfo.project.name);

  // ৳50 bill, ৳200 handed over, ৳150 kept on the new customer's account (an advance).
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("রহিম");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  const received = cart.getByTestId("received-input");
  await expect(async () => {
    await received.fill("200");
    await expect(received).not.toHaveValue("", { timeout: 500 });
  }).toPass();
  await cart.getByTestId("keep-extra-check").click();
  await cart.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // The payment cannot be cancelled while its sale stands: it says to cancel the sale first.
  await page.goto("/payments");
  await page.getByTestId("cancel-payment").first().click();
  await expect(page.getByTestId("payment-linked-sale")).toBeVisible();
  await page.getByTestId("payment-void-reason").fill("ভুল");
  await expect(page.getByTestId("payment-void-confirm")).toBeDisabled();
  await page.keyboard.press("Escape");

  // The sale's cancel dialog offers to take that money too (on by default).
  await page.goto("/sales");
  await page.getByTestId("sale-row").first().click();
  await page.getByTestId("void-sale").click();
  await expect(page.getByTestId("void-linked-payment")).toContainText("৳১৫০");
  await expect(page.getByTestId("void-payment-check")).toBeChecked();
  await page.getByTestId("void-sale-confirm").click();
  await expect(page.getByText("বাতিল").first()).toBeVisible();

  // Both are cancelled: the payment shows as cancelled and the customer owes nothing.
  await page.goto("/payments");
  await expect(
    page.getByTestId("payment-row").filter({ hasText: "বাতিল" }),
  ).toHaveCount(1);
  await page.goto("/customers");
  await page.getByTestId("party-row").filter({ hasText: "রহিম" }).click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳০");
});

test("cancelling the sale alone keeps the money on the account, which can then be cancelled by itself", async ({
  page,
}, testInfo) => {
  await newShopWithMilk(page, "lnk2", testInfo.project.name);
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("রহিম");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  const received = cart.getByTestId("received-input");
  await expect(async () => {
    await received.fill("200");
    await expect(received).not.toHaveValue("", { timeout: 500 });
  }).toPass();
  await cart.getByTestId("keep-extra-check").click();
  await cart.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  await page.goto("/sales");
  await page.getByTestId("sale-row").first().click();
  await page.getByTestId("void-sale").click();
  await page.getByTestId("void-payment-check").click(); // keep the money on the account
  await page.getByTestId("void-sale-confirm").click();
  await expect(page.getByText("বাতিল").first()).toBeVisible();

  // The customer still has ৳150 advance...
  await page.goto("/customers");
  await page.getByTestId("party-row").filter({ hasText: "রহিম" }).click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳১৫০");

  // ...and now that its sale is cancelled, the payment can be cancelled on its own.
  await page.goto("/payments");
  await page.getByTestId("cancel-payment").first().click();
  await expect(page.getByTestId("payment-linked-sale")).toHaveCount(0);
  await page.getByTestId("payment-void-reason").fill("ভুল");
  await page.getByTestId("payment-void-confirm").click();
  await page.goto("/customers");
  await page.getByTestId("party-row").filter({ hasText: "রহিম" }).click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳০");
});
