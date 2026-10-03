/**
 * QA audit, part 3: billing seen through the browser (findings B7, B8). See docs/QA-REPORT.md.
 */
import { expect, type Page, test } from "@playwright/test";
import { addCashier, indicator, signUp } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

async function tapPin(page: Page, pin: string) {
  for (const digit of pin) await page.getByTestId(`pin-${digit}`).click();
  await page.getByTestId("pin-submit").click();
}

test("QA B7: a cashier sees only where the shop stands and cannot send a payment", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;
  await signUp(page, `qabown${stamp}`);
  await addCashier(page, "সাবিনা", `qabcs${stamp}`, "1234");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByTestId("switch-user").click();
  await page.getByTestId("lock-user").filter({ hasText: "সাবিনা" }).click();
  await tapPin(page, "1234");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect
    .poll(async () => (await page.request.get("/api/billing")).status(), {
      timeout: 30_000,
    })
    .toBe(200);

  // Where the shop stands, and nothing else (no plans, no numbers to pay to, no payments).
  const view = (await (
    await page.request.get("/api/billing")
  ).json()) as Record<string, unknown>;
  expect(Object.keys(view)).toEqual(["billing"]);

  // A payment is the owner's or a manager's to send.
  const payment = await page.request.post("/api/billing/payments", {
    data: {
      method: "bkash",
      trxId: "CASHIER001",
      sender: "01711000001",
      amount: 50000,
      planId: "m1",
    },
  });
  expect(payment.status()).toBe(403);
});

test("QA B8: the service worker saves the app's pages, so the app opens offline", async ({
  page,
}) => {
  const response = await page.request.get("/serwist/sw.js");
  expect(response.status()).toBe(200);
  const worker = await response.text();
  for (const route of ["/pos", "/billing", "/login", "/dashboard", "/products"])
    expect(worker, `the page ${route} is in the saved list`).toContain(
      `url:"${route}"`,
    );
});
