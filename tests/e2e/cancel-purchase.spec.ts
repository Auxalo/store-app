import { expect, type Page, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

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

async function buy(page: Page, qty: string, paid: string) {
  await page.goto("/purchases/new");
  await page.getByTestId("supplier-button").click();
  await page.getByRole("button", { name: "করিম ট্রেডার্স" }).click();
  await page.getByPlaceholder("পণ্য যোগ করুন: নাম বা বারকোড লিখুন").fill("দুধ");
  await page.getByTestId("product-results").getByRole("button").first().click();
  await page.getByLabel("পরিমাণ").fill(qty);
  await page.getByLabel("প্রতিটির দাম").fill("40");
  await page.getByTestId("purchase-paid").fill(paid);
  await page.getByTestId("save-purchase").click();
  await expect(page).toHaveURL(/\/purchases\/view\?id=/);
}

async function supplierBalance(page: Page) {
  await page.goto("/suppliers");
  await page
    .getByTestId("party-row")
    .filter({ hasText: "করিম ট্রেডার্স" })
    .getByRole("link")
    .click();
  return page.getByTestId("party-balance-total");
}

test("a wrong purchase that was 'undone' with a return: cancel the return, then the purchase, and everything is as before", async ({
  page,
}, testInfo) => {
  await signUp(page, `cxp${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "0",
  });
  await addSupplier(page, "করিম ট্রেডার্স");

  // An older purchase on credit: the shop owes ৳400.
  await buy(page, "10", "0");
  // The wrong one: 4 at ৳40, paid ৳160 (entered as cash).
  await buy(page, "4", "160");
  const wrongUrl = page.url();

  // It was "undone" with a full return, and the return took ৳160 off what the shop owes.
  await page.getByTestId("return-goods").click();
  await page.getByTestId("return-lines").getByLabel("ফেরতের পরিমাণ").fill("4");
  await page.getByTestId("settle-due").click();
  await page.getByTestId("confirm-return").click();
  await expect(page.getByTestId("return-lines")).toBeHidden();
  await expect(await supplierBalance(page)).toHaveText("৳২৪০");

  // The return shows with the payments, as what returns took off a due.
  await page.goto("/payments");
  await page.getByTestId("tab-credits").click();
  await expect(page.getByTestId("return-credit-row")).toHaveCount(1);
  await expect(page.getByTestId("return-credit-row")).toContainText("৳১৬০");

  // The purchase cannot be cancelled while its return stands.
  await page.goto(wrongUrl);
  await page.getByTestId("void-purchase").click();
  await expect(page.getByTestId("void-purchase-has-returns")).toBeVisible();
  await expect(page.getByTestId("void-purchase-confirm")).toBeDisabled();
  await page.keyboard.press("Escape");

  // 1. Cancel the return (from the purchase's page): the goods and the ৳160 due come back.
  await page
    .getByTestId("purchase-return-list")
    .getByTestId("cancel-return")
    .click();
  await expect(page.getByTestId("void-return-effects")).toContainText("৳১৬০");
  await page.getByTestId("void-return-reason").fill("ভুল ছিল");
  await page.getByTestId("void-return-confirm").click();
  // Saved: the return is marked cancelled and has no cancel button any more.
  await expect(
    page.getByTestId("purchase-return-list").getByTestId("cancel-return"),
  ).toHaveCount(0);
  await expect(await supplierBalance(page)).toHaveText("৳৪০০");

  // 2. Cancel the purchase: its goods leave, its ৳160 payment is cancelled.
  await page.goto(wrongUrl);
  await page.getByTestId("void-purchase").click();
  await expect(page.getByTestId("void-purchase-effects")).toContainText("৳১৬০");
  await page.getByTestId("void-purchase-reason").fill("ভুল মাধ্যম");
  await page.getByTestId("void-purchase-confirm").click();
  await expect(page.getByTestId("purchase-voided")).toBeVisible();
  await expect(page.getByTestId("void-purchase")).toHaveCount(0);
  await expect(page.getByTestId("return-goods")).toHaveCount(0);

  // Everything is as before the mistake: owed ৳400, stock 10, and no money moved today.
  await expect(await supplierBalance(page)).toHaveText("৳৪০০");
  // (The wrong purchase was paid in full, so it never touched the supplier's account: only the
  // return and its cancellation show in the statement.)
  await expect(page.getByTestId("statement")).toContainText("ফেরত বাতিল");
  await page.goto("/inventory");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("১০ পিস");
  await page.goto("/money");
  await expect(page.getByTestId("money-empty")).toBeVisible();
  await page.goto("/purchases");
  await expect(page.getByTestId("purchase-row-voided")).toHaveCount(1);
});

test("a sale return that took money off a customer's due can be cancelled from the Payments page", async ({
  page,
}, testInfo) => {
  await signUp(page, `cxs${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  // ৳100 on credit to a new customer.
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("customer-button").click();
  await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
  await page.getByLabel("নাম", { exact: true }).fill("রহিম");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  const received = cart.getByTestId("received-input");
  await expect(async () => {
    await received.fill("0");
    await expect(received).not.toHaveValue("", { timeout: 500 });
  }).toPass();
  await cart.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // One comes back, taken off what they owe.
  await page.goto("/sales");
  await page.getByTestId("sale-row").first().click();
  await page.getByTestId("return-items").click();
  await page.getByTestId("return-lines").getByLabel("ফেরতের পরিমাণ").fill("1");
  await page.getByTestId("settle-due").click();
  await page.getByTestId("confirm-return").click();
  await expect(page.getByTestId("return-lines")).toBeHidden();

  // From Payments: cancel it.
  await page.goto("/payments");
  await page.getByTestId("tab-credits").click();
  await page
    .getByTestId("return-credit-row")
    .getByTestId("cancel-return")
    .click();
  await page.getByTestId("void-return-confirm").click();
  // Saved: the row is marked cancelled and has no cancel button any more.
  await expect(
    page.getByTestId("return-credit-row").getByTestId("cancel-return"),
  ).toHaveCount(0);

  // They owe the full ৳100 again, the milk is out of stock again (8 left), and the sale can now
  // be cancelled.
  await page.goto("/customers");
  await page.getByTestId("party-row").filter({ hasText: "রহিম" }).click();
  await expect(page.getByTestId("party-balance-total")).toHaveText("৳১০০");
  await page.goto("/inventory");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("৮ পিস");
  await page.goto("/sales");
  await page.getByTestId("sale-row").first().click();
  await expect(page.getByTestId("void-sale")).toBeVisible();
});
