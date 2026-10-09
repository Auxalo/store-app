import { expect, type Page, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/** Rings up `times` of the milk. A named customer (new) pays only 100, so the rest is due. */
async function sell(page: Page, times: number, customer?: [string, string]) {
  await page.goto("/pos");
  for (let i = 0; i < times; i++) await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  if (customer) {
    await cart.getByTestId("received-input").fill("100");
    await cart.getByTestId("customer-button").click();
    await page.getByRole("button", { name: "নতুন ক্রেতা" }).click();
    await page.getByLabel("নাম", { exact: true }).fill(customer[0]);
    await page.getByLabel("মোবাইল নম্বর").fill(customer[1]);
    await page.getByRole("button", { name: "সংরক্ষণ" }).click();
    await expect(cart.getByTestId("customer-button")).toContainText(
      customer[0],
    );
  }
  await cart.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toBeVisible();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();
}

test("sales can be found by buyer name, phone or invoice number, and filtered and sorted", async ({
  page,
}, testInfo) => {
  await signUp(page, `find${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    stock: "20",
  });
  await sell(page, 3, ["করিম", "01711111111"]); // 150, 50 due
  await sell(page, 1); // 50, walk-in, paid

  await page.goto("/sales");
  const rows = page.getByTestId("sale-row");
  await expect(rows).toHaveCount(2);
  const box = page.getByTestId("list-search");

  // By the buyer's name and by their phone number.
  await box.fill("করিম");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("৳১৫০");
  await box.fill("0171111");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("করিম");

  // By invoice number: the second sale is number 2 in either mode's numbering.
  await box.fill("0002");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("৳৫০");

  // Nothing matches: say so, and clearing the search brings everything back.
  await box.fill("zzzz");
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId("sales-empty")).toBeVisible();
  await box.fill("");
  await expect(rows).toHaveCount(2);

  // Filter to sales with something still owing.
  await page.getByTestId("list-filters").click();
  await page.getByTestId("filter-dueOnly").click();
  await page.getByTestId("filters-done").click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("করিম");
  await expect(page.getByTestId("list-filter-count")).toBeVisible();
  await page.getByTestId("list-clear").click();
  await expect(rows).toHaveCount(2);

  // Sort by the biggest total first.
  await page.getByTestId("list-sort").click();
  await page.getByRole("option", { name: "বেশি টাকা আগে" }).click();
  await expect(rows.first()).toContainText("৳১৫০");
});
