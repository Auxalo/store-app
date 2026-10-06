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

test("stock cannot be adjusted below zero, and the counter warns when a sale needs more than is in stock", async ({
  page,
}, testInfo) => {
  await signUp(page, `stock${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "3",
  });

  // Counter: the fourth tap is more than the 3 in stock. A warning appears; selling is still allowed.
  await page.goto("/pos");
  for (let i = 0; i < 3; i++) await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await expect(cart.getByTestId("stock-warning")).toHaveCount(0);
  await cart.getByLabel("পরিমাণ").fill("4");
  await expect(cart.getByTestId("stock-warning")).toBeVisible();
  await cart.getByLabel("পরিমাণ").fill("3");
  await expect(cart.getByTestId("stock-warning")).toHaveCount(0);

  // Adjust stock: removing 5 from 3 would leave less than nothing, so it cannot be saved.
  await page.goto("/inventory");
  const row = page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" });
  await row.getByRole("button", { name: "স্টক সমন্বয়" }).click();
  await page.getByRole("tab", { name: "বাদ" }).click();
  await page.getByLabel(/পরিমাণ/).fill("5");
  await expect(page.getByTestId("below-zero")).toBeVisible();
  await expect(page.getByRole("button", { name: "সংরক্ষণ" })).toBeDisabled();
  await page.getByLabel(/পরিমাণ/).fill("2");
  await expect(page.getByTestId("below-zero")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "সংরক্ষণ" })).toBeEnabled();
});

test("on a short phone screen the whole cart, including the Sell button, can be reached (BUG-1)", async ({
  page,
}, testInfo) => {
  await signUp(page, `short${Date.now()}${testInfo.project.name}`);
  for (const [name, nameBn] of [
    ["Fresh Milk", "ফ্রেশ দুধ"],
    ["Miniket Rice", "মিনিকেট চাল"],
    ["Soap", "সাবান"],
  ] as const)
    await createProduct(page, { name, nameBn, price: "50", stock: "10" });

  for (const [width, height] of [
    [360, 640],
    [320, 568],
    [412, 700],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/pos");
    for (const nameBn of ["ফ্রেশ দুধ", "মিনিকেট চাল", "সাবান"])
      await tapProduct(page, nameBn);
    await openCart(page);
    const sell = page.getByTestId("complete-sale");
    await expect(sell).toBeVisible();
    await sell.scrollIntoViewIfNeeded();
    const box = await sell.boundingBox();
    expect(box, `${width}x${height}`).not.toBeNull();
    // Fully on screen: nothing hangs below the bottom edge.
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height);
    // And it works from here.
    if (width === 412) {
      await sell.click();
      await expect(page.locator("#print-receipt")).toBeVisible();
    }
  }
});

test("on a phone, picking a product shows it in the list at once, and it is still there after the sale (BUG-2)", async ({
  page,
}, testInfo) => {
  await signUp(page, `pick${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/pos");

  const row = page.getByTestId("picker-row").filter({ hasText: "ফ্রেশ দুধ" });
  await expect(row).toContainText("১০ পিস");
  await row.click();
  await expect(row).toContainText("×১"); // the pick shows on the list right away
  await expect(page.getByTestId("view-cart")).toContainText("১টি পণ্য");

  await openCart(page);
  await page.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // Sold: the product is still listed, with its new stock and no leftover mark.
  await expect(row).toBeVisible();
  await expect(row).toContainText("৯ পিস");
  await expect(row).not.toContainText("×১");
});
