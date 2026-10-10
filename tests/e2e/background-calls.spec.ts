import { expect, test } from "@playwright/test";
import { addCategory, indicator, signIn, signUp } from "./helpers";
import { deviceOptions } from "./mode";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/**
 * Background calls cost the server (each wakes a function), so an open tab asks rarely: every few
 * minutes while shown, and not at all while hidden, then once when shown again.
 */
const THIRTY_MINUTES = 30 * 60_000;
const background = (path: string) =>
  path.startsWith("/api/sync/") ||
  path === "/api/staff" ||
  path === "/api/health" ||
  path.startsWith("/api/data/settings");

async function setVisibility(
  page: import("@playwright/test").Page,
  state: "hidden" | "visible",
) {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => s,
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => s === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("an idle tab asks the server every few minutes, a hidden tab not at all, and a shown tab at once", async ({
  page,
}, testInfo) => {
  // The clock is controlled from the start, so the app's own timers are the ones that run.
  await page.clock.install();
  await signUp(page, `idle${Date.now()}${testInfo.project.name}`);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });

  const calls: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (background(path)) calls.push(path);
  });

  // Half an hour of an open tab nobody touches: a few checks, not one a minute.
  await page.clock.runFor(THIRTY_MINUTES);
  await page.waitForTimeout(2_000);
  // (Checks whether the server is back, after a failed try, are not counted: the test's clock jumps
  // half an hour in a moment, which no real outage does.)
  const regular = calls.filter((path) => path !== "/api/health");
  expect(regular.length).toBeGreaterThan(0);
  expect(regular.length).toBeLessThanOrEqual(10);

  // Half an hour hidden: nothing.
  await setVisibility(page, "hidden");
  await page.waitForTimeout(1_000);
  calls.length = 0;
  await page.clock.runFor(THIRTY_MINUTES);
  await page.waitForTimeout(2_000);
  expect(calls).toEqual([]);

  // Shown again: it syncs right away.
  await setVisibility(page, "visible");
  await expect.poll(() => calls.length, { timeout: 15_000 }).toBeGreaterThan(0);
});

test("another device's change shows up when the tab is shown again, long before the next timed sync", async ({
  page,
  browser,
}, testInfo) => {
  const username = `focus${Date.now()}${testInfo.project.name}`;
  await signUp(page, username);
  await page.goto("/categories");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });

  // Device B: the same shop, open on the categories list.
  const second = await browser.newContext(
    deviceOptions(testInfo.project.use.baseURL),
  );
  const pageB = await second.newPage();
  await signIn(pageB, username);
  await pageB.goto("/categories");
  await expect(indicator(pageB, "synced")).toBeVisible({ timeout: 30_000 });

  // A adds a category; B is not told (its next timed sync is minutes away).
  await addCategory(page, "Dairy", "দুগ্ধজাত");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });
  const rowB = pageB.getByTestId("category-row").filter({ hasText: "দুগ্ধজাত" });
  // (Showing the tab twice within a few seconds is one sync: wait past that.)
  await pageB.waitForTimeout(16_000);
  await expect(rowB).toHaveCount(0);

  // B's tab is hidden and shown again: it asks at once and the new category appears.
  await setVisibility(pageB, "hidden");
  await setVisibility(pageB, "visible");
  await expect(rowB).toBeVisible({ timeout: 20_000 });

  await second.close();
});
