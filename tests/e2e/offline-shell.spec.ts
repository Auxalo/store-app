import { expect, test } from "@playwright/test";

// Stop the page's background sync and service worker before the context closes; closing a
// context that still has them running can stall for the full test timeout.
test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

// Phase 1 exit criteria: install, sign up in Bangla, reload and navigate with no network.
test("app shell works offline after first load", async ({
  page,
  context,
}, testInfo) => {
  const username = `shop${Date.now()}${testInfo.project.name}`;

  // --- Sign up (Bangla names, to check encoding end to end) ---
  await page.goto("/signup");
  await page.getByLabel("দোকানের নাম").fill("রহিম স্টোর");
  await page.getByLabel("আপনার নাম").fill("রহিম উদ্দিন");
  await page.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(username);
  await page.getByLabel("পাসওয়ার্ড").fill("password123");
  await page.getByRole("button", { name: "দোকান তৈরি করুন" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "ড্যাশবোর্ড", level: 1 }),
  ).toBeVisible();

  // The Bangla names survived the round trip to MongoDB and back.
  const session = await page.evaluate(async () =>
    (await fetch("/api/auth/get-session")).json(),
  );
  expect(session.user.name).toBe("রহিম উদ্দিন");
  const store = await page.evaluate(async () =>
    (await fetch("/api/stores/current")).json(),
  );
  expect(store.name).toBe("রহিম স্টোর");

  // --- Service worker installed and controlling ---
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "ড্যাশবোর্ড", level: 1 }),
  ).toBeVisible();

  // --- Go offline and reload ---
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "ড্যাশবোর্ড", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("অফলাইন", { exact: true }).first()).toBeVisible();

  // --- Navigate to a route never opened before, still offline ---
  await page.goto("/pos");
  await expect(
    page.getByRole("heading", { name: "বিক্রয় কাউন্টার", level: 1 }),
  ).toBeVisible();

  // --- Language switch works offline and is instant ---
  await page.getByRole("button", { name: "ভাষা" }).click();
  await expect(
    page.getByRole("heading", { name: "POS", level: 1 }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "POS", level: 1 }),
  ).toBeVisible();

  await context.setOffline(false);
});

test("signing in with a wrong password shows an error and stays on the login page", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill("nobody-here");
  await page.getByLabel("পাসওয়ার্ড").fill("wrong-password");
  await page.getByRole("button", { name: "সাইন ইন", exact: true }).click();
  await expect(page.locator("p[role=alert]")).toContainText(
    "ইউজারনেম বা পাসওয়ার্ড ভুল",
  );
  await expect(page).toHaveURL(/\/login$/);
});

test("unauthenticated visitors are sent to the login page", async ({
  page,
}) => {
  await page.goto("/products");
  await expect(page).toHaveURL(/\/login$/);
});
