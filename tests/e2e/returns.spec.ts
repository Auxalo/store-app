import { expect, type Page, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/**
 * The money around a return, from the counter's point of view: the refund clears what the customer
 * owes first, cancelling is not offered once something came back, Reports add up and agree with the
 * dashboard, and store credit pays for the next sale.
 */

async function sellMilk(
  page: Page,
  count: number,
  options: { received: string; customer?: "new" | string },
) {
  await page.goto("/pos");
  for (let i = 0; i < count; i++) await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  if (options.customer === "new") {
    await cart.getByTestId("customer-button").click();
    await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
    await page.getByLabel("নাম", { exact: true }).fill("রহিম");
    await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  } else if (options.customer) {
    await cart.getByTestId("customer-button").click();
    await page
      .getByRole("button", { name: new RegExp(options.customer) })
      .click();
  }
  await cart.getByTestId("received-input").fill(options.received);
  return cart;
}

async function finishSale(page: Page) {
  await page.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();
}

test("a refund clears the due first, cancel is gone after a return, and every screen adds up", async ({
  page,
}, testInfo) => {
  await signUp(page, `ret${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "30",
  });

  // 1. ৳200 on credit to a new customer, then ALL of it comes back.
  await sellMilk(page, 4, { received: "0", customer: "new" });
  await finishSale(page);
  await page.goto("/sales");
  await page.getByTestId("sale-row").first().click();
  await page.getByTestId("return-items").click();
  await page.getByTestId("return-lines").getByLabel("ফেরতের পরিমাণ").fill("4");
  // The refund clears what they owe; no cash leaves the till.
  await expect(page.getByTestId("party-balance-now")).toContainText("৳২০০");
  await expect(page.getByTestId("split-off")).toContainText("৳২০০");
  await expect(page.getByTestId("split-cash")).toContainText("৳০");
  await page.getByTestId("confirm-return").click();
  await expect(page.getByTestId("return-lines")).toBeHidden();
  await expect(page.getByTestId("fully-returned")).toBeVisible();
  await expect(page.getByTestId("void-sale")).toHaveCount(0);
  await expect(page.getByTestId("return-items")).toHaveCount(0);

  // The customer owes nothing.
  await page.goto("/customers");
  await expect(page.getByTestId("party-balance")).toHaveCount(0);

  // 2. A cash sale of ৳150, one piece returned: partly returned, and "return the rest" replaces cancel.
  await sellMilk(page, 3, { received: "150" });
  await finishSale(page);
  await page.goto("/sales");
  await page.getByTestId("sale-row").first().click();
  await page.getByTestId("return-items").click();
  await page.getByTestId("return-lines").getByLabel("ফেরতের পরিমাণ").fill("1");
  // A walk-in sale: the refund is cash.
  await expect(page.getByTestId("split-cash")).toContainText("৳৫০");
  await expect(page.getByTestId("keep-credit")).toHaveCount(0);
  await page.getByTestId("confirm-return").click();
  await expect(page.getByTestId("return-lines")).toBeHidden();
  await expect(page.getByTestId("partly-returned")).toBeVisible();
  await expect(page.getByTestId("void-sale")).toHaveCount(0);
  await expect(page.getByTestId("return-items")).toContainText("বাকিটা ফেরত নিন");

  // 3. One more cash sale of ৳100 that stays sold.
  await sellMilk(page, 2, { received: "100" });
  await finishSale(page);

  // Reports for today: bills 3, sales after returns 200 + ... = 0 + 100 + 100 = 200, and it all adds up.
  await page.goto("/reports");
  await expect(page.getByTestId("r-count")).toHaveText("৩");
  await expect(page.getByTestId("r-total")).toHaveText("৳৪৫০");
  await expect(page.getByTestId("r-returns")).toHaveText("৳২৫০");
  await expect(page.getByTestId("r-net")).toHaveText("৳২০০");
  // Received: 0 + 150 + 100, less ৳50 handed back = 200. Nothing is left unpaid: the ৳200 that was
  // owed came off by the return (the reported bug: it stayed).
  await expect(page.getByTestId("r-received")).toHaveText("৳২০০");
  await expect(page.getByTestId("r-unpaid")).toHaveText("৳০");
  await expect(page.getByTestId("kpi-credit")).toContainText("৳০");
  await expect(page.getByTestId("payment-split")).toContainText(
    "ফেরত দেওয়া নগদ",
  );

  // The dashboard says the same for today.
  await page.goto("/dashboard");
  await expect(page.getByTestId("stat-todaySales")).toHaveText("৳২০০");
  await expect(page.getByTestId("stats")).toContainText("৩টি বিক্রি");
});

test("store credit pays for the next sale first, and a refund hands credit back as credit", async ({
  page,
}, testInfo) => {
  await signUp(page, `cr${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "30",
  });

  // A customer who paid ৳50 ahead: a credit sale for one piece, then they pay ৳100 (৳50 more than owed).
  await sellMilk(page, 1, { received: "0", customer: "new" });
  await finishSale(page);
  await page.goto("/customers");
  await page.getByTestId("party-row").filter({ hasText: "রহিম" }).click();
  await page.getByTestId("record-payment").click();
  await page.getByTestId("payment-amount").fill("100");
  await page.getByTestId("save-payment").click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳৫০");

  // Next purchase of ৳100: the POS shows the credit, uses it, and asks for the rest only.
  const cart = await sellMilk(page, 2, { received: "", customer: "রহিম" });
  await expect(cart.getByTestId("store-credit")).toContainText("৳৫০");
  await expect(cart.getByTestId("use-credit")).toBeChecked();
  await expect(cart.getByTestId("credit-used")).toContainText("৳৫০");
  await expect(cart.getByTestId("received-input")).toHaveAttribute(
    "placeholder",
    "50",
  );
  await finishSale(page);

  // The credit is used up: nothing owed either way.
  await page.goto("/customers");
  await page.getByTestId("party-row").filter({ hasText: "রহিম" }).click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳০");

  // The sale says so, and so do Reports.
  await page.goto("/sales");
  await page.getByTestId("sale-row").first().click();
  await expect(page.getByTestId("receipt-preview")).toContainText(
    "জমা থেকে পরিশোধ",
  );
  await page.goto("/reports");
  await expect(page.getByTestId("r-credit-used")).toHaveText("৳৫০");
  // The ৳50 left unpaid when the first piece was sold stays in that sale's own figure (the ৳100
  // collected later is a payment, on the customer's page); the sale that used credit adds nothing.
  await expect(page.getByTestId("r-unpaid")).toHaveText("৳৫০");

  // That sale comes back in full: the ৳50 of credit it used goes back as credit, ৳50 in cash.
  await page.goto("/sales");
  await page.getByTestId("sale-row").first().click();
  await page.getByTestId("return-items").click();
  await page.getByTestId("return-lines").getByLabel("ফেরতের পরিমাণ").fill("2");
  await expect(page.getByTestId("split-kept")).toContainText("৳৫০");
  await expect(page.getByTestId("split-cash")).toContainText("৳৫০");
  await page.getByTestId("confirm-return").click();
  await expect(page.getByTestId("return-lines")).toBeHidden();
  await page.goto("/customers");
  await page.getByTestId("party-row").filter({ hasText: "রহিম" }).click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳৫০");
});

test("a purchase return clears what the shop owes first, and Reports count it", async ({
  page,
}, testInfo) => {
  await signUp(page, `pr${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
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

  // Buy 10 at ৳40 on credit: ৳400 is owed.
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

  // Send 4 back (৳160): it comes off what the shop owes, no cash comes in.
  await page.getByTestId("return-goods").click();
  await page.getByTestId("return-lines").getByLabel("ফেরতের পরিমাণ").fill("4");
  await expect(page.getByTestId("party-balance-now")).toContainText("৳৪০০");
  await expect(page.getByTestId("split-off")).toContainText("৳১৬০");
  await expect(page.getByTestId("split-cash")).toContainText("৳০");
  await page.getByTestId("confirm-return").click();
  await expect(page.getByTestId("return-lines")).toBeHidden();

  await page.goto("/suppliers");
  await page
    .getByTestId("party-row")
    .filter({ hasText: "করিম ট্রেডার্স" })
    .getByRole("link")
    .click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳২৪০");

  // Reports: purchases are net of what went back.
  await page.goto("/reports");
  await page.getByTestId("tab-profit").click();
  await expect(page.getByTestId("r-purchases")).toContainText("৳২৪০");
  await expect(page.getByTestId("r-purchase-returns")).toContainText("৳১৬০");
  await expect(page.getByTestId("r-owed-suppliers")).toHaveText("৳২৪০");

  // The dashboard's "purchases today" is net as well.
  await page.goto("/dashboard");
  await expect(page.getByTestId("stat-todayPurchases")).toHaveText("৳২৪০");
});
