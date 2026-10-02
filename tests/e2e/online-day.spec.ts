import { expect, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

// A whole shop day in online mode, starting from the app's own default for a new device.
test.use({ storageState: { cookies: [], origins: [] } });

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

test("an online shop day: buy stock, sell for cash and on credit, collect, return, spend, and the numbers add up", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await signUp(page, `day${Date.now()}${testInfo.project.name}`);
  expect(await page.evaluate(() => localStorage.getItem("sa.dataMode"))).toBe(
    "online",
  );

  // Morning: a product with no stock, and a supplier.
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "0",
  });
  await page.goto("/suppliers");
  await page.getByRole("button", { name: "সরবরাহকারী যোগ করুন" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("করিম ট্রেডার্স");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(
    page.getByTestId("party-row").filter({ hasText: "করিম ট্রেডার্স" }),
  ).toBeVisible();

  // Buy 10 at ৳45 (৳450), paying ৳100 now: the stock comes in and ৳350 is owed.
  await page.goto("/purchases/new");
  await page.getByTestId("supplier-button").click();
  await page.getByRole("button", { name: "করিম ট্রেডার্স" }).click();
  await page.getByPlaceholder("পণ্য যোগ করুন: নাম বা বারকোড লিখুন").fill("দুধ");
  await page.getByTestId("product-results").getByRole("button").first().click();
  await page.getByLabel("পরিমাণ").fill("10");
  await page.getByLabel("প্রতিটির দাম").fill("45");
  await page.getByTestId("purchase-paid").fill("100");
  await expect(page.getByTestId("purchase-due")).toHaveText("৳৩৫০");
  await page.getByTestId("save-purchase").click();
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);
  // The server numbers online documents: P-, then the month and a running number.
  await expect(page.getByText(/^P-\d{4}-\d{5}$/)).toBeVisible();

  // Pay the supplier ৳200: ৳150 left.
  await page.goto("/suppliers");
  await page
    .getByTestId("party-row")
    .filter({ hasText: "করিম ট্রেডার্স" })
    .getByRole("link")
    .click();
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("200");
  await page.getByTestId("save-payment").click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳১৫০");

  // A cash sale of 2 (৳100), then a credit sale of 1 (৳50, nothing paid) to a new customer.
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  await page.getByTestId("complete-sale").click();
  const receipt = page.locator("#print-receipt");
  await expect(receipt).toContainText("৳১০০.০০");
  await expect(receipt).toContainText(/-00001/); // the first online invoice
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("received-input").fill("0");
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("রহিম");
  await page.getByLabel("মোবাইল নম্বর").fill("01722222222");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await cart.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toContainText(/-00002/);
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // The customer pays ৳25 of the ৳50.
  await page.goto("/customers");
  await page
    .getByTestId("party-row")
    .filter({ hasText: "রহিম" })
    .getByRole("link")
    .click();
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("25");
  await page.getByTestId("save-payment").click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳২৫");

  // Rent: ৳500.
  await page.goto("/expenses");
  await page.getByTestId("add-expense").click();
  await page.getByTestId("expense-amount").fill("500");
  await page.getByLabel("বিবরণ").fill("ভাড়া");
  await page.getByTestId("save-expense").click();
  await expect(page.getByTestId("expense-total")).toContainText("৳৫০০");

  // A customer brings one back from the cash sale: ৳50 refunded.
  await page.goto("/sales");
  const sales = page.getByTestId("sale-row");
  await expect(sales).toHaveCount(2);
  await sales.filter({ hasText: "৳১০০" }).click();
  await page.getByTestId("return-items").click();
  await page.getByTestId("return-lines").getByLabel("ফেরতের পরিমাণ").fill("1");
  await expect(page.getByTestId("refund-total")).toHaveText("৳৫০");
  await page.getByTestId("confirm-return").click();
  await expect(page.getByTestId("return-lines")).toBeHidden();

  // Stock: 10 bought − 3 sold + 1 back = 8.
  await page.goto("/inventory");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("৮ পিস");

  // Closing: the reports agree with everything above.
  await page.goto("/reports");
  await expect(page.getByTestId("r-total")).toHaveText("৳১৫০");
  await expect(page.getByTestId("r-returns")).toHaveText("৳৫০");
  await expect(page.getByTestId("r-net")).toHaveText("৳১০০");
  await page.getByTestId("tab-dues").click();
  await expect(page.getByText("রহিম")).toBeVisible();
  await expect(page.getByText("করিম ট্রেডার্স")).toBeVisible();
});
