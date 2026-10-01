import { expect, test } from "@playwright/test";
import { addCategory, indicator, signIn, signUp } from "./helpers";

// Stop the page's background sync and service worker before the context closes; closing a
// context that still has them running can stall for the full test timeout.
test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

// Phase 2 exit criteria: work created offline survives a reload, syncs on reconnect without
// duplicates, and reaches a second device (which can edit it back).
test("offline work syncs once connectivity returns and appears on a second device", async ({
  page,
  context,
  browser,
}, testInfo) => {
  const username = `sync${Date.now()}${testInfo.project.name}`;
  await signUp(page, username);

  // Wait for the first full sync, then lose the network.
  await page.goto("/categories");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });
  await context.setOffline(true);
  await expect(indicator(page, "offline")).toBeVisible();

  // Create a category while offline: it appears instantly and is queued.
  await addCategory(page, "Dairy", "দুগ্ধজাত");
  const row = page.getByTestId("category-row").filter({ hasText: "দুগ্ধজাত" });
  await expect(row).toBeVisible();
  await expect(indicator(page, "offline")).toContainText("১"); // one change waiting (Bangla digit)

  // Reload with no network: still there, still waiting.
  await page.reload();
  await expect(row).toBeVisible();
  await expect(indicator(page, "offline")).toContainText("১");

  // Reconnect: it syncs by itself.
  await context.setOffline(false);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });

  // The server has exactly one copy.
  const pulled = await page.evaluate(async () =>
    (await fetch("/api/sync/pull?cursor=0")).json(),
  );
  expect(
    pulled.changes.categories.filter(
      (c: { name: string }) => c.name === "Dairy",
    ),
  ).toHaveLength(1);

  // A second device signs in and downloads it.
  const second = await browser.newContext({
    locale: "bn-BD",
    baseURL: testInfo.project.use.baseURL,
  });
  const pageB = await second.newPage();
  await signIn(pageB, username);
  await pageB.goto("/categories");
  const rowB = pageB.getByTestId("category-row").filter({ hasText: "দুগ্ধজাত" });
  await expect(rowB).toBeVisible({ timeout: 20_000 });

  // Each device has its own short code.
  await pageB.goto("/sync");
  await expect(pageB.getByText("B", { exact: true })).toBeVisible();

  // B edits; A picks it up with "Sync now".
  await pageB.goto("/categories");
  await rowB.getByRole("button", { name: "সম্পাদনা" }).click();
  await pageB.getByLabel("বাংলা নাম").fill("দুধ ও দুগ্ধজাত");
  await pageB.getByRole("button", { name: "সংরক্ষণ" }).click();
  // Wait for the server itself to hold B's edit (the chip can lag a moment behind a click).
  await expect
    .poll(
      async () => {
        const res = await pageB.evaluate(async () =>
          (await fetch("/api/sync/pull?cursor=0")).json(),
        );
        return res.changes.categories.find(
          (c: { name: string }) => c.name === "Dairy",
        )?.nameBn;
      },
      { timeout: 20_000 },
    )
    .toBe("দুধ ও দুগ্ধজাত");

  await page.goto("/sync");
  await page.getByRole("button", { name: "এখনই সিঙ্ক করুন" }).click();
  await page.goto("/categories");
  await expect(
    page.getByTestId("category-row").filter({ hasText: "দুধ ও দুগ্ধজাত" }),
  ).toBeVisible({ timeout: 20_000 });

  await second.close();
});

test("signing out warns when changes have not reached the cloud", async ({
  page,
  context,
}, testInfo) => {
  await signUp(page, `warn${Date.now()}${testInfo.project.name}`);
  await page.goto("/categories");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  await addCategory(page, "Unsent", "অপ্রেরিত");
  await expect(page.getByTestId("category-row")).toBeVisible();

  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByRole("menuitem", { name: "সাইন আউট" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "সিঙ্ক না হওয়া পরিবর্তন",
  );

  await page.getByRole("button", { name: "বাতিল" }).click();
  await expect(page).toHaveURL(/\/categories$/);
  await context.setOffline(false);
});
