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

async function addSupplier(page: Page, name: string) {
  await page.goto("/suppliers");
  await page.getByRole("button", { name: "সরবরাহকারী যোগ করুন" }).click();
  await page.getByLabel("নাম", { exact: true }).fill(name);
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(
    page.getByTestId("party-row").filter({ hasText: name }),
  ).toBeVisible();
}

test("buy stock on credit, pay the supplier, and see it all on a second device", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.skip(
    E2E_MODE === "online",
    "this is about the offline queue, which online mode does not use",
  );
  const username = `buy${Date.now()}${testInfo.project.name}`;
  await signUp(page, username);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "0",
  });
  await addSupplier(page, "করিম ট্রেডার্স");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);

  // New purchase: 10 pieces at ৳45, paying ৳100 now.
  await page.goto("/purchases/new");
  await page.getByTestId("supplier-button").click();
  await page.getByRole("button", { name: "করিম ট্রেডার্স" }).click();
  await page.getByPlaceholder("পণ্য যোগ করুন: নাম বা বারকোড লিখুন").fill("দুধ");
  await page.getByTestId("product-results").getByRole("button").first().click();
  await page.getByLabel("পরিমাণ").fill("10");
  await page.getByLabel("প্রতিটির দাম").fill("45");
  await page.getByTestId("purchase-paid").fill("100");
  await expect(page.getByTestId("purchase-total")).toHaveText("৳৪৫০");
  await expect(page.getByTestId("purchase-due")).toHaveText("৳৩৫০");
  await page.getByTestId("save-purchase").click();

  // The purchase page shows it, with the numbered purchase and what is owed.
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);
  await expect(page.getByText(/^P-/)).toBeVisible();
  await expect(page.getByTestId("purchase-items")).toContainText("ফ্রেশ দুধ");
  await expect(page.getByTestId("purchase-items")).toContainText("১০ পিস");

  // Stock came in at once.
  await page.goto("/inventory");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("১০ পিস");

  // The supplier is owed 350; paying 200 leaves 150, and the statement shows both lines.
  await page.goto("/suppliers");
  await expect(page.getByTestId("party-balance")).toContainText("আমরা দেব ৳৩৫০");
  await page
    .getByTestId("party-row")
    .filter({ hasText: "করিম ট্রেডার্স" })
    .getByRole("link")
    .click();
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("200");
  await page.getByTestId("save-payment").click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳১৫০");
  await expect(page.getByTestId("statement-row")).toHaveCount(2);
  await expect(page.getByTestId("statement")).toContainText("পেমেন্ট");
  await expect(page.getByTestId("statement")).toContainText("ক্রয়");

  // Back online; a second device sees the supplier's balance.
  await context.setOffline(false);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });
  const second = await browser.newContext(
    deviceOptions(testInfo.project.use.baseURL),
  );
  const pageB = await second.newPage();
  await signIn(pageB, username);
  await pageB.goto("/suppliers");
  await expect(pageB.getByTestId("party-balance")).toContainText(
    "আমরা দেব ৳১৫০",
    { timeout: 20_000 },
  );
  await pageB.goto("/payments");
  await expect(pageB.getByTestId("payment-row")).toHaveCount(1);
  await second.close();
});

test("collect a customer's due after a credit sale", async ({
  page,
}, testInfo) => {
  await signUp(page, `due${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("received-input").fill("0");
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("রহিম");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await cart.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  await page.goto("/customers");
  await expect(page.getByTestId("party-balance")).toContainText("বাকি ৳১০০");
  await page
    .getByTestId("party-row")
    .filter({ hasText: "রহিম" })
    .getByRole("link")
    .click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳১০০");
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("60");
  await page.getByTestId("save-payment").click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳৪০");
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("40");
  await page.getByTestId("save-payment").click();
  await expect(page.getByText("সব মেটানো")).toBeVisible();
  await expect(page.getByTestId("statement-row")).toHaveCount(3); // sale, two payments

  // The last payment was a mistake: cancel it (a reason is needed). The 40 is owed again, both
  // lines stay on the statement, and the payment shows as cancelled.
  await page.getByTestId("cancel-payment").first().click();
  await expect(page.getByTestId("payment-void-confirm")).toBeDisabled();
  await page.getByTestId("payment-void-reason").fill("ভুল এন্ট্রি");
  await page.getByTestId("payment-void-confirm").click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳৪০");
  await expect(page.getByTestId("statement-row")).toHaveCount(4);
  await expect(page.getByTestId("statement")).toContainText("পেমেন্ট বাতিল");
  await expect(page.getByTestId("cancel-payment")).toHaveCount(1); // only the first payment is left to cancel

  // The payments list keeps it, marked cancelled, and it no longer counts in the total.
  await page.goto("/payments");
  await expect(page.getByTestId("payment-row")).toHaveCount(2);
  await expect(
    page.getByTestId("payment-row").filter({ hasText: "বাতিল" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("payment-count")).toBeVisible();
  await expect(page.getByText("৳৬০").first()).toBeVisible();
});

test("expenses: add one, see the total, cancel it", async ({
  page,
}, testInfo) => {
  await signUp(page, `exp${Date.now()}${testInfo.project.name}`);
  await page.goto("/expenses");
  await page.getByTestId("add-expense").click();
  await page.getByTestId("expense-amount").fill("৫০০০");
  await page.getByLabel("বিবরণ").fill("অক্টোবরের ভাড়া");
  await page.getByTestId("save-expense").click();

  const row = page.getByTestId("expense-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("ভাড়া");
  await expect(row).toContainText("৳৫,০০০");
  await expect(page.getByTestId("expense-total")).toContainText("৳৫,০০০");

  await row.getByRole("button", { name: "খরচ বাতিল করুন" }).click();
  await page.getByRole("button", { name: "খরচ বাতিল করুন" }).last().click();
  await expect(row).toContainText("বাতিল");
  await expect(page.getByTestId("expense-total")).toContainText("৳০");
});

test("return goods from a sale: stock goes back, and you cannot return more than was sold", async ({
  page,
}, testInfo) => {
  await signUp(page, `ret${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await page.goto("/pos");
  for (let i = 0; i < 3; i++) await tapProduct(page, "ফ্রেশ দুধ"); // sell 3
  await openCart(page);
  await page.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  await page.goto("/sales");
  await page.getByTestId("sale-row").click();
  await page.getByTestId("return-items").click();
  const dialog = page.getByTestId("return-lines");
  await expect(dialog).toContainText("সর্বোচ্চ ৩ পিস");

  await dialog.getByLabel("ফেরতের পরিমাণ").fill("1");
  await expect(page.getByTestId("refund-total")).toHaveText("৳৫০");
  await page.getByTestId("confirm-return").click();
  // Wait until it is saved (the dialog closes) before leaving the page, or the save can be cut off.
  await expect(page.getByTestId("return-lines")).toBeHidden();

  // Stock: 10 − 3 + 1 = 8.
  await page.goto("/inventory");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("৮ পিস");
  await page.goto("/returns");
  await expect(page.getByTestId("return-row")).toHaveCount(1);
  await expect(page.getByTestId("return-row")).toContainText("৳৫০");

  // Only 2 can still come back, and asking for more is not accepted.
  await page.goto("/sales");
  await page.getByTestId("sale-row").click();
  await page.getByTestId("return-items").click();
  await expect(page.getByTestId("return-lines")).toContainText("সর্বোচ্চ ২ পিস");
  await page.getByTestId("return-lines").getByLabel("ফেরতের পরিমাণ").fill("3");
  await expect(page.getByTestId("refund-total")).toHaveText("৳০");
  await expect(page.getByTestId("confirm-return")).toBeDisabled();
});
