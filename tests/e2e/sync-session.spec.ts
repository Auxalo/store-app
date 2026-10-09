import { expect, type Page, test } from "@playwright/test";
import {
  addCashier,
  createProduct,
  indicator,
  openCart,
  signIn,
  signUp,
  tapProduct,
} from "./helpers";
import { E2E_MODE } from "./mode";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/**
 * QA's sync findings: a sale made just before signing out, another shop signing in on the same
 * device, two tabs, and work by an owner who signed in with the password.
 */

async function sellOne(page: Page, name = "ফ্রেশ দুধ") {
  await page.goto("/pos");
  await tapProduct(page, name);
  await openCart(page);
  await page.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();
}

/** Goes to the counter through the menu, without reloading the page. */
async function toCounter(page: Page) {
  await page.locator('a[href="/pos"]').first().click();
  await expect(page).toHaveURL(/\/pos$/);
}

async function sellHere(page: Page, name = "ফ্রেশ দুধ") {
  await tapProduct(page, name);
  await openCart(page);
  await page.getByTestId("complete-sale").click();
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();
}

async function openSignOut(page: Page) {
  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByTestId("sign-out").click();
}

test("signing out with an unsent sale sends it first, and the next shop on this device sees nothing of it", async ({
  page,
  context,
}, testInfo) => {
  test.skip(E2E_MODE === "online", "about the offline queue");
  const shopA = `sa${Date.now()}${testInfo.project.name}`;
  const shopB = `sb${Date.now()}${testInfo.project.name}`;
  await signUp(page, shopB, "মিঠু স্টোর");
  // (Signing up saves a setting or two: let them reach the server, or sign-out first asks to send.)
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });
  await openSignOut(page);
  await expect(page).toHaveURL(/\/login$/);

  await signUp(page, shopA, "আশিক স্টোর");
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  // A sale with no internet, then "sign out": the app asks to send it first.
  await context.setOffline(true);
  await sellOne(page);
  await openSignOut(page);
  await expect(page.getByTestId("sign-out-dialog")).toBeVisible();
  await context.setOffline(false);
  await page.getByTestId("sign-out-send").click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

  // The other shop signs in on this device: none of the first shop's data shows.
  await signIn(page, shopB);
  await page.goto("/sales");
  await expect(page.getByTestId("sale-row")).toHaveCount(0);
  await page.goto("/products");
  await expect(page.getByText("ফ্রেশ দুধ")).toHaveCount(0);
  await openSignOut(page);
  await expect(page).toHaveURL(/\/login$/);

  // The first shop signs back in: its sale reached the server and is there.
  await signIn(page, shopA);
  await page.goto("/sales");
  await expect(page.getByTestId("sale-row")).toHaveCount(1, {
    timeout: 30_000,
  });
});

test("signing out without sending deletes the unsent work only after a second, explicit yes", async ({
  page,
  context,
}, testInfo) => {
  test.skip(E2E_MODE === "online", "about the offline queue");
  const shop = `sd${Date.now()}${testInfo.project.name}`;
  await signUp(page, shop);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });
  await context.setOffline(true);
  await sellOne(page);
  await openSignOut(page);
  await page.getByTestId("sign-out-discard").click();
  await expect(page.getByTestId("sign-out-discard-confirm")).toBeVisible();
  // Changing one's mind keeps everything.
  await page.getByRole("button", { name: "বাতিল" }).click();
  await expect(page).toHaveURL(/\/pos$/);
  await openSignOut(page);
  await page.getByTestId("sign-out-discard").click();
  await page.getByTestId("sign-out-discard-confirm").click();
  await expect(page).toHaveURL(/\/login$/);
  await context.setOffline(false);
});

test("an owner who has a PIN but signed in with the password: their sale reaches the server", async ({
  page,
}, testInfo) => {
  const owner = `pw${Date.now()}${testInfo.project.name}`;
  await signUp(page, owner);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  // The owner sets a PIN, and staff have PINs too.
  await addCashier(page, "সাবিনা", `c${Date.now()}`, "1234");
  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByTestId("set-my-pin").click();
  await page.getByTestId("pin-input").fill("482913");
  await page.getByTestId("pin-confirm").fill("482913");
  await page.getByTestId("save-pin").click();
  await expect(page.getByTestId("pin-input")).toHaveCount(0);

  // Signs out and back in with the password (no PIN typed), then sells.
  await openSignOut(page);
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, owner);
  await toCounter(page);
  await sellHere(page);
  // The server takes it (before the fix it was refused: PROOF_REQUIRED, and undone on the device).
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });
  await expect(indicator(page, "issue")).toHaveCount(0);
  await page.locator('a[href="/sales"]').first().click();
  await expect(page.getByTestId("sale-row")).toHaveCount(1, {
    timeout: 15_000,
  });
});

test("two tabs: the PIN typed in one, the sale made in the other, and it is not lost", async ({
  page,
  context,
}, testInfo) => {
  test.skip(E2E_MODE === "online", "about the offline queue");
  const owner = `tt${Date.now()}${testInfo.project.name}`;
  await signUp(page, owner);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await addCashier(page, "সাবিনা", `c${Date.now()}`, "1234");
  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByTestId("set-my-pin").click();
  await page.getByTestId("pin-input").fill("482913");
  await page.getByTestId("pin-confirm").fill("482913");
  await page.getByTestId("save-pin").click();
  await expect(page.getByTestId("pin-input")).toHaveCount(0);

  // Tab A stays open on the counter (signed in with the password).
  await toCounter(page);

  // Tab B: the owner unlocks with the PIN.
  const tabB = await context.newPage();
  await tabB.goto("/dashboard");
  await tabB.getByTestId("lock-user").filter({ hasText: "রহিম" }).click();
  for (const digit of "482913") await tabB.getByTestId(`pin-${digit}`).click();
  await tabB.getByTestId("pin-submit").click();
  await expect(tabB.getByTestId("lock-screen")).toHaveCount(0);

  // Tab A: a sale here reaches the server.
  await sellHere(page);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });
  await expect(indicator(page, "issue")).toHaveCount(0);
  await page.locator('a[href="/sales"]').first().click();
  await expect(page.getByTestId("sale-row")).toHaveCount(1, {
    timeout: 15_000,
  });
  await tabB.close();
});
