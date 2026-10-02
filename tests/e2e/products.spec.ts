import { expect, type Page, test } from "@playwright/test";
import { indicator, signIn, signUp } from "./helpers";
import { deviceOptions, E2E_MODE } from "./mode";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

const searchBox = (page: Page) =>
  page.getByPlaceholder("নাম, SKU বা বারকোড দিয়ে খুঁজুন");

/** Adjusts stock from the Inventory screen: mode is "নির্ধারণ" (set), "যোগ" (add) or "বাদ" (remove). */
async function adjustFromInventory(
  page: Page,
  productName: string,
  mode: string,
  amount: string,
) {
  const row = page.getByTestId("product-row").filter({ hasText: productName });
  await row.getByRole("button", { name: "স্টক সমন্বয়" }).click();
  await page.getByRole("tab", { name: mode }).click();
  await page.getByLabel(/পরিমাণ/).fill(amount);
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();
}

test("products: create offline, search in Bangla, adjust stock, sync to a second device", async ({
  page,
  context,
  browser,
}, testInfo) => {
  test.skip(
    E2E_MODE === "online",
    "this is about the offline queue, which online mode does not use",
  );
  const username = `prod${Date.now()}${testInfo.project.name}`;
  await signUp(page, username);
  await page.goto("/products");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  // Everything below happens with no internet.
  await context.setOffline(true);
  await page.goto("/products/new");
  await page.getByLabel("পণ্যের নাম").fill("Fresh Milk");
  await page.getByLabel("বাংলা নাম").fill("ফ্রেশ দুধ");
  await page.getByLabel("ক্রয়মূল্য (৳)", { exact: true }).fill("40");
  await page.getByLabel("বিক্রয়মূল্য (৳)").fill("৫০"); // Bangla digits are accepted in numeric fields
  await page.getByLabel(/এখন হাতে স্টক/).fill("১০");
  await page.getByRole("button", { name: "সংরক্ষণ" }).click();

  await expect(page).toHaveURL(/\/products$/);
  const row = page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("৳৫০");
  await expect(row).toContainText("১০ পিস");

  // Search by Bangla, by English, and for something that does not exist.
  await searchBox(page).fill("দুধ");
  await expect(row).toBeVisible();
  await searchBox(page).fill("milk");
  await expect(row).toBeVisible();
  await searchBox(page).fill("zzzz");
  await expect(page.getByText("আপনার খোঁজার সাথে কোনো পণ্য মেলেনি।")).toBeVisible();
  await searchBox(page).fill("");

  // Adjust stock: "set to 8" is recorded as a movement of −2.
  await page.goto("/inventory");
  await adjustFromInventory(page, "ফ্রেশ দুধ", "নির্ধারণ", "৮");
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("৮ পিস");

  await page.goto("/products");
  await row.click();
  await expect(page).toHaveURL(/\/products\/view\?id=/);
  const movements = page.getByTestId("movement-row");
  await expect(movements).toHaveCount(2);
  await expect(movements.first()).toContainText("সমন্বয়");
  await expect(movements.first()).toContainText("-২");
  await expect(movements.last()).toContainText("প্রারম্ভিক স্টক");
  await expect(movements.last()).toContainText("+১০");

  // Back online: it syncs by itself.
  await context.setOffline(false);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });

  // A second device receives the product with stock 8 and can search it in Bangla.
  const second = await browser.newContext(
    deviceOptions(testInfo.project.use.baseURL),
  );
  const pageB = await second.newPage();
  await signIn(pageB, username);
  await pageB.goto("/inventory");
  const rowB = pageB.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" });
  await expect(rowB).toBeVisible({ timeout: 20_000 });
  await expect(rowB).toContainText("৮ পিস");
  await expect(indicator(pageB, "synced")).toBeVisible({ timeout: 20_000 });

  // Both devices change the same product's stock while offline; the changes add up.
  await context.setOffline(true);
  await second.setOffline(true);
  await page.goto("/inventory");
  await adjustFromInventory(page, "ফ্রেশ দুধ", "যোগ", "৫"); // A received 5 → 13
  await adjustFromInventory(pageB, "ফ্রেশ দুধ", "বাদ", "১"); // B sold 1  → 7
  await expect(
    page.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
  ).toContainText("১৩ পিস");
  await expect(rowB).toContainText("৭ পিস");

  await context.setOffline(false);
  await second.setOffline(false);

  // The server ends up with 8 + 5 − 1 = 12.
  await expect
    .poll(
      async () => {
        const res = await page.evaluate(async () =>
          (await fetch("/api/sync/pull?cursor=0")).json(),
        );
        return res.changes.products.find(
          (p: { name: string }) => p.name === "Fresh Milk",
        )?.stock;
      },
      { timeout: 30_000 },
    )
    .toBe(12_000);

  // Each device converges on 12 after its next sync.
  for (const p of [page, pageB]) {
    await p.goto("/sync");
    await p.getByRole("button", { name: "এখনই সিঙ্ক করুন" }).click();
    await expect(indicator(p, "synced")).toBeVisible({ timeout: 20_000 });
    await p.goto("/inventory");
    await expect(
      p.getByTestId("product-row").filter({ hasText: "ফ্রেশ দুধ" }),
    ).toContainText("১২ পিস", {
      timeout: 20_000,
    });
  }

  await second.close();
});
