import { expect, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

test("lowering a price shows the cut in the Discount field (a raised price is not a discount)", async ({
  page,
}, testInfo) => {
  await signUp(page, `cut${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "100",
    cost: "60",
    stock: "20",
  });
  await page.goto("/pos");
  // Two pieces at ৳100 = ৳200.
  await tapProduct(page, "ফ্রেশ দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  const price = cart.getByRole("textbox", { name: "একক দাম" });
  const discount = cart.getByTestId("discount-input");

  // Nothing lowered yet: the Discount field is empty.
  await expect(discount).toHaveValue("");
  await expect(cart.getByTestId("discount-price-cut")).toHaveCount(0);

  // ৳100 → ৳90 on two pieces: ৳20 cut, shown as the discount; the total is what is charged.
  await price.fill("90");
  await expect(discount).toHaveValue("20");
  await expect(cart.getByTestId("discount-price-cut")).toBeVisible();
  await expect(cart.getByTestId("cart-total")).toHaveText("৳১৮০");

  // A discount typed on top is added to it (৳25 in all): total ৳175.
  await discount.fill("25");
  await expect(cart.getByTestId("cart-total")).toHaveText("৳১৭৫");
  await cart.getByTestId("received-input").click();
  await expect(discount).toHaveValue("25");

  // Raising the price above the list price is not a discount: only the typed ৳5 is left.
  await price.fill("120");
  await expect(cart.getByTestId("discount-price-cut")).toHaveCount(0);
  await expect(discount).toHaveValue("5");
  await expect(cart.getByTestId("cart-total")).toHaveText("৳২৩৫");

  // Back to ৳90 with no typed discount: clearing the box cannot remove the price cut.
  await price.fill("90");
  await discount.fill("");
  await cart.getByTestId("received-input").click();
  await expect(discount).toHaveValue("20");
  await expect(cart.getByTestId("cart-total")).toHaveText("৳১৮০");

  // The sale goes through at what was charged.
  await cart.getByTestId("complete-sale").click();
  const receipt = page.locator("#print-receipt");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("৳১৮০.০০");
  // The invoice shows the item at its list price and the cut as the discount.
  await expect(receipt).toContainText("৳১০০");
  await expect(receipt).toContainText("৳২০০.০০"); // subtotal at list price
  await expect(receipt).toContainText("− ৳২০.০০"); // the discount
});

test("the invoice shows list prices and one total discount for many items; a raised price stays", async ({
  page,
}, testInfo) => {
  await signUp(page, `cuts${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "90",
    cost: "60",
    stock: "20",
  });
  await createProduct(page, {
    name: "চিনি",
    price: "50",
    cost: "40",
    stock: "20",
  });
  await createProduct(page, {
    name: "সাবান",
    price: "30",
    cost: "20",
    stock: "20",
  });
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await tapProduct(page, "চিনি");
  await tapProduct(page, "সাবান");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  const prices = cart.getByRole("textbox", { name: "একক দাম" });
  await expect(prices).toHaveCount(3);

  // Milk ৳90 → ৳80 (two pieces: ৳20 off), sugar ৳50 → ৳40 (৳10 off), soap ৳30 → ৳35 (raised).
  await prices.nth(0).fill("80");
  await prices.nth(1).fill("40");
  await prices.nth(2).fill("35");
  // The Discount field adds the cuts up: ৳30. The total is what is charged: 160 + 40 + 35.
  await expect(cart.getByTestId("discount-input")).toHaveValue("30");
  await expect(cart.getByTestId("cart-total")).toHaveText("৳২৩৫");

  await cart.getByTestId("complete-sale").click();
  const receipt = page.locator("#print-receipt");
  await expect(receipt).toBeVisible();
  // Milk and sugar are at their list prices, soap at the raised price.
  await expect(receipt).toContainText("৳৯০");
  await expect(receipt).toContainText("৳৫০");
  await expect(receipt).toContainText("৳৩৫");
  await expect(receipt).not.toContainText("৳৮০");
  await expect(receipt).not.toContainText("৳৪০");
  // Subtotal 180 + 50 + 35 = 265, one discount of 30, total 235.
  await expect(receipt).toContainText("৳২৬৫.০০");
  await expect(receipt).toContainText("− ৳৩০.০০");
  await expect(receipt).toContainText("৳২৩৫.০০");
});

test("on a phone the cart sheet stays on the screen while a price box is tapped", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone layout");
  await signUp(page, `sheet${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "100",
    cost: "60",
    stock: "20",
  });
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  const cart = page.getByTestId("cart-panel");
  const price = cart.getByRole("textbox", { name: "একক দাম" });
  const sheet = page.locator('[data-slot="drawer-content"]');
  const inside = async (locator: typeof sheet, height: number) => {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(height + 1);
  };

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const { width, height } = viewport ?? { width: 390, height: 844 };
  await price.click();
  await inside(sheet, height);
  await inside(price, height);

  // The keyboard takes the lower half of the screen: the sheet shrinks above it and the box
  // that was tapped is still on the screen.
  await page.setViewportSize({ width, height: Math.round(height / 2) });
  await page.waitForTimeout(900);
  await inside(sheet, Math.round(height / 2));
  await inside(price, Math.round(height / 2));
  await price.fill("80");
  await expect(cart.getByTestId("discount-input")).toHaveValue("20");
  await inside(sheet, Math.round(height / 2));
});
