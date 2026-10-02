import { expect, test } from "@playwright/test";
import { createProduct, signUp } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

test("a product needs a name and both prices; its SKU is created automatically", async ({
  page,
}, testInfo) => {
  await signUp(page, `sku${Date.now()}${testInfo.project.name}`);

  // Saving with only a name is refused, with a message on each price.
  await page.goto("/products/new");
  await page.getByLabel("পণ্যের নাম").fill("Fresh Milk");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(page).toHaveURL(/\/products\/new/);
  await expect(page.getByText("এই ঘরটি পূরণ করতে হবে")).toHaveCount(2);

  // A zero price is refused too.
  await page.getByLabel("ক্রয়মূল্য (৳)", { exact: true }).fill("0");
  await page.getByLabel("বিক্রয়মূল্য (৳)").fill("50");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(page.getByText("০-এর বেশি হতে হবে")).toBeVisible();

  // Selling below cost is allowed, but warned about.
  await page.getByLabel("ক্রয়মূল্য (৳)", { exact: true }).fill("60");
  await expect(page.getByTestId("below-cost")).toBeVisible();
  await page.getByLabel("ক্রয়মূল্য (৳)", { exact: true }).fill("40");
  await expect(page.getByTestId("below-cost")).toHaveCount(0);

  // The SKU box shows what it will be, and leaving it empty creates it.
  await expect(page.getByLabel("SKU")).toHaveAttribute(
    "placeholder",
    /[A-Z0-9]+\d{4}/,
  );
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(page).toHaveURL(/\/products$/);
  await page
    .getByTestId("product-row")
    .filter({ hasText: "Fresh Milk" })
    .click();
  await expect(page.getByText(/^[A-Z0-9]+\d{4}$/)).toBeVisible();

  // The next one gets the next number.
  await createProduct(page, {
    name: "Rice",
    nameBn: "চাল",
    price: "75",
    stock: "10",
  });
});

test("the audit log is off by default and asks before turning on", async ({
  page,
}, testInfo) => {
  await signUp(page, `aud${Date.now()}${testInfo.project.name}`);
  await page.goto("/settings");
  const toggle = page.getByTestId("audit-toggle");
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await expect(page.getByText("অডিট লগ চালু করবেন?")).toBeVisible();
  await page.getByRole("button", { name: "বন্ধই থাকুক" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await toggle.click();
  await page.getByTestId("audit-confirm").click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  // The audit screen no longer says it is off.
  await page.goto("/settings/audit");
  await expect(page.getByTestId("audit-off")).toHaveCount(0);
});

test("the audit screen says when the log is off", async ({
  page,
}, testInfo) => {
  await signUp(page, `auo${Date.now()}${testInfo.project.name}`);
  await page.goto("/settings/audit");
  await expect(page.getByTestId("audit-off")).toBeVisible();
});

test("the sidebar shows the sync status and the developer's details", async ({
  page,
}, testInfo) => {
  await signUp(page, `dev${Date.now()}${testInfo.project.name}`);
  // On a phone the sidebar opens from "More"; on a desktop it is always there.
  const more = page.getByRole("button", { name: "আরও" });
  if (await more.isVisible()) await more.click();

  const info = page.getByTestId("developer-info");
  await expect(info).toContainText("Sohel Ashik");
  await expect(
    info.getByRole("link", { name: "sohelashik.com" }),
  ).toHaveAttribute("href", "https://sohelashik.com");
  await expect(info.getByRole("link", { name: /01772998823/ })).toHaveAttribute(
    "href",
    "https://wa.me/8801772998823",
  );
  await expect(page.getByTestId("sidebar-sync")).toBeVisible();
});
