import { expect, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/**
 * The cash drawer card on the dashboard: the opening cash is set when the shop opens, cash sales
 * move it, and the owner can correct the opening (every entry stays in the day log).
 */
test("the drawer: set the opening, a cash sale moves it, the owner corrects it, and the log keeps both", async ({
  page,
}, testInfo) => {
  await signUp(page, `drawer${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });

  // Not set yet: a reminder, counting from zero.
  await page.goto("/dashboard");
  const card = page.getByTestId("cash-drawer");
  await expect(card.getByTestId("drawer-form")).toBeVisible();
  await expect(card.getByTestId("drawer-expected")).toHaveText("৳০");

  await card.getByTestId("drawer-amount").fill("500");
  await card.getByTestId("drawer-save").click();
  await expect(card.getByTestId("drawer-expected")).toHaveText("৳৫০০");
  await expect(card.getByTestId("drawer-opening")).toContainText("৳৫০০");
  await expect(card.getByTestId("drawer-form")).toHaveCount(0);

  // A 50 taka cash sale puts 50 taka in the drawer.
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  await page.getByTestId("received-input").fill("50");
  await page.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  await page.goto("/dashboard");
  await expect(card.getByTestId("drawer-expected")).toHaveText("৳৫৫০");
  await card.getByTestId("drawer-details-toggle").click();
  await expect(card.getByTestId("drawer-flow-sales")).toContainText("৳৫০");

  // The owner corrects the opening to 600: expected becomes 650, and both entries are in the log.
  await card.getByTestId("drawer-correct").click();
  await card.getByTestId("drawer-amount").fill("600");
  await card.getByTestId("drawer-save").click();
  await expect(card.getByTestId("drawer-expected")).toHaveText("৳৬৫০");
  await expect(card.getByTestId("drawer-log-entry")).toHaveCount(2);
  await expect(card.getByTestId("drawer-log")).toContainText("সংশোধন");
});
