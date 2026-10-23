import { expect, type Page, test } from "@playwright/test";
import { openCart, signUp, tapProduct } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

const unitRow = (page: Page, name: string) =>
  page.getByTestId("unit-row").filter({ hasText: name });

async function addUnit(page: Page, name: string, loose = false) {
  await page.goto("/customize/units");
  await page.getByTestId("unit-add").click();
  await page.getByTestId("unit-name").fill(name);
  if (loose) await page.getByTestId("unit-loose").click();
  await page.getByTestId("unit-save").click();
  await expect(unitRow(page, name)).toBeVisible();
}

/** The product form, filled in; the unit is picked by its name. */
async function newProduct(
  page: Page,
  p: { name: string; unit: string; price: string; stock: string },
) {
  await page.goto("/products/new");
  await page.getByLabel("পণ্যের নাম").fill(p.name);
  await page.getByLabel("বিক্রয়মূল্য (৳)").fill(p.price);
  await page.getByLabel(/এখন হাতে স্টক/).fill(p.stock);
  await page
    .getByLabel("ক্রয়মূল্য (৳)", { exact: true })
    .fill(String(Math.round(Number(p.price) * 0.8)));
  await pickUnit(page, p.unit);
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(page).toHaveURL(/\/products$/);
}

async function pickUnit(page: Page, name: string) {
  await page.getByTestId("unit-select").click();
  await page.getByRole("option", { name, exact: true }).click();
}

test("a shop adds its own unit, sells in it, renames it, and cannot remove it while a product uses it", async ({
  page,
}, testInfo) => {
  await signUp(page, `unit${Date.now()}${testInfo.project.name}`);

  // The Customize area opens the units page.
  await page.goto("/customize");
  await page.getByTestId("card-units").click();
  await expect(page).toHaveURL(/\/customize\/units$/);
  // The built-in units are listed and editable too.
  await expect(unitRow(page, "ডজন")).toBeVisible();

  await addUnit(page, "বস্তা");
  await expect(unitRow(page, "বস্তা")).toContainText("পূর্ণ সংখ্যা");

  // A product in the new unit, sold at the counter: the receipt names the unit.
  await newProduct(page, { name: "চাল", unit: "বস্তা", price: "300", stock: "5" });
  await page.goto("/pos");
  await tapProduct(page, "চাল");
  await openCart(page);
  await page.getByTestId("complete-sale").click();
  await expect(page.locator("#print-receipt")).toContainText("বস্তা");

  // Renaming shows the new name everywhere, old invoices included.
  await page.goto("/customize/units");
  await unitRow(page, "বস্তা").getByTestId("unit-edit").click();
  await page.getByTestId("unit-name").fill("বস্তা (৫০ কেজি)");
  await page.getByTestId("unit-save").click();
  await expect(unitRow(page, "বস্তা (৫০ কেজি)")).toBeVisible();
  await page.goto("/sales");
  await page.getByTestId("sale-row").click();
  await expect(page.getByTestId("receipt-preview")).toContainText(
    "বস্তা (৫০ কেজি)",
  );

  // Removing is blocked while the product uses it, and the product is listed.
  await page.goto("/customize/units");
  await unitRow(page, "বস্তা (৫০ কেজি)").getByTestId("unit-remove").click();
  await expect(page.getByTestId("unit-in-use")).toContainText("চাল");
  await expect(page.getByTestId("unit-remove-confirm")).toHaveCount(0);

  // Move the product to another unit (through the link in the list), then it can be removed.
  await page
    .getByTestId("unit-in-use")
    .getByRole("link", { name: "চাল" })
    .click();
  await pickUnit(page, "পিস");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(page).not.toHaveURL(/\/products\/edit/);

  await page.goto("/customize/units");
  await unitRow(page, "বস্তা (৫০ কেজি)").getByTestId("unit-remove").click();
  await expect(page.getByTestId("unit-in-use")).toHaveCount(0);
  await page.getByTestId("unit-remove-confirm").click();
  await expect(unitRow(page, "বস্তা (৫০ কেজি)")).toHaveCount(0);

  // It is gone from the product form, but the old sale still shows its name.
  await page.goto("/products/new");
  await page.getByTestId("unit-select").click();
  await expect(
    page.getByRole("option", { name: "বস্তা (৫০ কেজি)", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/sales");
  await page.getByTestId("sale-row").click();
  await expect(page.getByTestId("receipt-preview")).toContainText(
    "বস্তা (৫০ কেজি)",
  );

  // It can be brought back from the removed list.
  await page.goto("/customize/units");
  await page.getByTestId("unit-removed").locator("summary").click();
  await page.getByTestId("unit-restore").click();
  await expect(unitRow(page, "বস্তা (৫০ কেজি)")).toBeVisible();
});

test("a built-in unit can be removed and restored, and a missing unit is added from the product form", async ({
  page,
}, testInfo) => {
  await signUp(page, `unit2${Date.now()}${testInfo.project.name}`);

  await page.goto("/customize/units");
  await unitRow(page, "ডজন").getByTestId("unit-remove").click();
  await page.getByTestId("unit-remove-confirm").click();
  await expect(unitRow(page, "ডজন")).toHaveCount(0);

  // The product form no longer offers it, but offers "+ নতুন একক".
  await page.goto("/products/new");
  await page.getByTestId("unit-select").click();
  await expect(
    page.getByRole("option", { name: "ডজন", exact: true }),
  ).toHaveCount(0);
  await page.getByTestId("unit-new").click();
  await page.getByTestId("unit-name").fill("হালি");
  await page.getByTestId("unit-save").click();
  // The new unit is picked for this product at once.
  await expect(page.getByTestId("unit-select")).toContainText("হালি");

  // Bring the built-in unit back.
  await page.goto("/customize/units");
  await page.getByTestId("unit-removed").locator("summary").click();
  await page.getByTestId("unit-restore").click();
  await expect(unitRow(page, "ডজন")).toBeVisible();
});

test("a unit sold in fractions takes decimals; a whole-number unit does not", async ({
  page,
}, testInfo) => {
  await signUp(page, `unit3${Date.now()}${testInfo.project.name}`);
  await addUnit(page, "গজ", true);
  await expect(unitRow(page, "গজ")).toContainText("ভাঙা পরিমাণও চলে");

  // 2.5 in a fractional unit is fine.
  await newProduct(page, {
    name: "কাপড়",
    unit: "গজ",
    price: "100",
    stock: "2.5",
  });

  // 2.5 pieces is not: the form says so and does not save.
  await page.goto("/products/new");
  await page.getByLabel("পণ্যের নাম").fill("ডিম");
  await page.getByLabel("বিক্রয়মূল্য (৳)").fill("10");
  await page.getByLabel("ক্রয়মূল্য (৳)", { exact: true }).fill("8");
  await page.getByLabel(/এখন হাতে স্টক/).fill("2.5");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(page).toHaveURL(/\/products\/new$/);
});
