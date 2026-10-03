/**
 * QA audit: money flows seen from the screen (findings C6 and POS-1).
 *
 * These were bugs found by the QA audit and are now fixed; the tests keep them fixed. See docs/QA-REPORT.md.
 */
import { expect, type Page, test } from "@playwright/test";
import {
  addCashier,
  createProduct,
  indicator,
  openCart,
  search,
  signUp,
  tapProduct,
} from "./helpers";
import { E2E_MODE } from "./mode";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

async function tapPin(page: Page, pin: string) {
  for (const digit of pin) await page.getByTestId(`pin-${digit}`).click();
  await page.getByTestId("pin-submit").click();
}

async function switchUser(page: Page) {
  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByTestId("switch-user").click();
  await expect(page.getByTestId("lock-screen")).toBeVisible();
}

test("QA C6: a cashier (who cannot see purchase prices) can ring up a sale", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  // In online mode the cart line has no cost for a cashier (the server hides purchase prices
  // from them) and the sale input requires one: the sale is refused with INVALID_INPUT.
  const stamp = `${Date.now()}${testInfo.project.name}`;
  await signUp(page, `qaown${stamp}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await addCashier(page, "সাবিনা", `qacash${stamp}`, "1234");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });

  // The counter is handed to the cashier.
  await switchUser(page);
  await page.getByTestId("lock-user").filter({ hasText: "সাবিনা" }).click();
  await tapPin(page, "1234");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0, {
    timeout: 20_000,
  });
  await page.locator('a[href="/pos"]').first().click();
  await expect(page.getByTestId("pos")).toBeVisible();

  await search(page).fill("দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  // Online, the sale is a request to the server: look at what it answers.
  const answer =
    E2E_MODE === "online"
      ? page.waitForResponse(
          (r) =>
            r.url().includes("/api/commands") &&
            r.request().method() === "POST",
          { timeout: 30_000 },
        )
      : null;
  await page.getByTestId("complete-sale").click();
  if (answer) {
    const response = await answer;
    const body = await response.text();
    console.log(
      `QA C6 server answer: ${response.status()} ${body.slice(0, 120)}`,
    );
    expect(response.status(), body).toBe(200);
  }

  // The receipt appears: the sale was accepted.
  await expect(page.locator("#print-receipt")).toContainText("ফ্রেশ দুধ", {
    timeout: 20_000,
  });
});

test("QA POS-1: while a sale is being saved, 'hold' must not keep a copy of the sold items", async ({
  page,
}, testInfo) => {
  test.skip(
    E2E_MODE !== "online",
    "offline, a sale is saved instantly: there is no moment to press hold in",
  );
  test.setTimeout(240_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;
  await signUp(page, `qapos${stamp}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });
  await page.goto("/pos");
  await expect(page.getByTestId("pos")).toBeVisible();
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);

  // A slow connection: the save takes a few seconds.
  await page.route("**/api/commands", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });
  const cart = page.getByTestId("cart-panel");
  await cart.getByTestId("complete-sale").click();
  await expect(cart.getByTestId("complete-sale")).toContainText("সংরক্ষণ");

  // The cashier taps "hold" while the sale is on its way.
  await cart.getByRole("button", { name: "অপেক্ষায় রাখুন" }).click({ force: true });

  // The sale goes through. The sold items must not also be waiting on hold (resuming them would
  // sell the same goods a second time).
  await expect(page.locator("#print-receipt")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "নতুন বিক্রি" }).click();
  const bar = page.getByTestId("view-cart");
  if (await bar.isVisible()) {
    // A phone: the bar is enabled only while a cart waits on hold.
    await expect(bar).toBeDisabled();
  } else {
    await expect(page.getByText(/অপেক্ষায় \(/)).toHaveCount(0);
  }
});
