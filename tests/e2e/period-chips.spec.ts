import { expect, test } from "@playwright/test";
import { createProduct, openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/** Today / 7 days / 30 days / All on the sales, purchases and payments lists. */
test("period chips on the sales, purchases and payments lists", async ({
  page,
}, testInfo) => {
  await signUp(page, `chips${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "ফ্রেশ দুধ",
    price: "50",
    cost: "40",
    stock: "10",
  });
  await page.goto("/pos");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  await page.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();

  // Sales opens on today and has all four chips; the sale made today is in each period.
  await page.goto("/sales");
  await expect(page.getByTestId("period-today")).toHaveAttribute(
    "data-state",
    "active",
  );
  for (const p of ["days7", "days30", "all", "today"]) {
    await page.getByTestId(`period-${p}`).click();
    await expect(page.getByTestId("sale-row")).toHaveCount(1);
  }

  // Purchases and payments open on All, with the same chips.
  for (const path of ["/purchases", "/payments"]) {
    await page.goto(path);
    await expect(page.getByTestId("period-chips")).toBeVisible();
    await expect(page.getByTestId("period-all")).toHaveAttribute(
      "data-state",
      "active",
    );
    await page.getByTestId("period-days30").click();
    await expect(page.getByTestId("period-days30")).toHaveAttribute(
      "data-state",
      "active",
    );
  }
});
