import { expect, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/**
 * Fixes from the bug tracker that show up in the numbers: how people paid counts money received
 * (BUG-22), the average bill is after returns (BUG-23), a sale's or purchase's own "due" says it is
 * the due at that time (BUG-25), and Reports > Profit shows what is owed to suppliers now (BUG-35).
 */
test("reports count money received and current dues, and lists say what a due means", async ({
  page,
}, testInfo) => {
  await signUp(page, `bugs${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "20",
  });

  // A ৳200 sale to a new customer, ৳150 received: ৳50 is owed.
  await page.goto("/pos");
  for (let i = 0; i < 4; i++) await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("received-input").fill("150");
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("রহিম");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await cart.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // Two of the four come back (৳100 refunded).
  await page.goto("/sales");
  await page.getByTestId("sale-row").click();
  await page.getByTestId("return-items").click();
  await page.getByTestId("return-lines").getByLabel("ফেরতের পরিমাণ").fill("2");
  await page.getByTestId("confirm-return").click();
  await expect(page.getByTestId("return-lines")).toBeHidden();

  // Reports, Sales tab: money by method is what came in (150), not the sale (200); the average
  // bill is after the return (100 over one sale), like the total beside it.
  await page.goto("/reports");
  await expect(page.getByTestId("payment-split")).toContainText("৳১৫০");
  await expect(page.getByTestId("payment-split")).not.toContainText("৳২০০");
  await expect(page.getByTestId("kpi-count")).toContainText("গড় বিল ৳১০০");

  // The customer pays the ৳50: the sale's own figure still says what it was when the sale was made.
  await page.goto("/customers");
  await page.getByTestId("party-row").filter({ hasText: "রহিম" }).click();
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("50");
  await page.getByTestId("save-payment").click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳০");
  await page.goto("/sales");
  await expect(page.getByTestId("sale-row")).toContainText(
    "বিক্রির সময় বাকি ৳৫০",
  );
  await page.getByTestId("sale-row").click();
  await expect(page.getByTestId("due-at-sale-note")).toBeVisible();
});

test("Reports > Profit shows what the shop owes suppliers now, after a payment", async ({
  page,
}, testInfo) => {
  await signUp(page, `owed${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "0",
  });
  await page.goto("/suppliers");
  await page.getByRole("button", { name: "সরবরাহকারী যোগ করুন" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("করিম ট্রেডার্স");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(
    page.getByTestId("party-row").filter({ hasText: "করিম ট্রেডার্স" }),
  ).toBeVisible();

  // Buy 10 at ৳40 on credit (৳400 owed), then pay ৳150: ৳250 is owed.
  await page.goto("/purchases/new");
  await page.getByTestId("supplier-button").click();
  await page.getByRole("button", { name: "করিম ট্রেডার্স" }).click();
  await page.getByPlaceholder("পণ্য যোগ করুন: নাম বা বারকোড লিখুন").fill("দুধ");
  await page.getByTestId("product-results").getByRole("button").first().click();
  await page.getByLabel("পরিমাণ").fill("10");
  await page.getByLabel("প্রতিটির দাম").fill("40");
  await page.getByTestId("purchase-paid").fill("0");
  await page.getByTestId("save-purchase").click();
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);

  await page.goto("/suppliers");
  await page
    .getByTestId("party-row")
    .filter({ hasText: "করিম ট্রেডার্স" })
    .getByRole("link")
    .click();
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("150");
  await page.getByTestId("save-payment").click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳২৫০");

  // The Profit tab agrees with the supplier page, not with the ৳400 owed on the day of purchase.
  await page.goto("/reports");
  await page.getByTestId("tab-profit").click();
  await expect(page.getByTestId("r-owed-suppliers")).toHaveText("৳২৫০");

  // The purchase itself still says what it was owed when it was bought.
  await page.goto("/purchases");
  await expect(page.getByTestId("purchase-row")).toContainText(
    "ক্রয়ের সময় বাকি ৳৪০০",
  );
});
