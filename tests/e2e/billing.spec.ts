import { execFileSync } from "node:child_process";
import {
  type Browser,
  expect,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";
import { appReadyOffline, signUp } from "./helpers";
import { E2E_MODE } from "./mode";

/** The test server's own database (never the one in .env.local). */
const dbPort = Number(process.env.DEV_DB_PORT ?? 27018);
const env = {
  ...process.env,
  MONGODB_URI:
    process.env.E2E_MONGODB_URI ??
    `mongodb://127.0.0.1:${dbPort}/?replicaSet=rs0`,
  MONGODB_DB: process.env.E2E_MONGODB_DB ?? "store_app_e2e",
};

/** A Dhaka calendar day, `offset` days from today, as a date input wants it. */
const dhakaDay = (offset: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(
    new Date(Date.now() + offset * 86_400_000),
  );

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/** An operator, signed in to the panel in their own browser. */
async function operator(browser: Browser, testInfo: TestInfo, stamp: string) {
  const username = `bop${stamp}`;
  execFileSync(
    "node",
    [
      "scripts/create-admin.mjs",
      "--name",
      "Billing Operator",
      "--username",
      username,
      "--password",
      "operator-pass-1",
      "--yes",
    ],
    { env, stdio: "pipe" },
  );
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "en-US",
  });
  const admin = await context.newPage();
  await admin.goto("/admin?tab=shops");
  await admin.getByPlaceholder("Username").fill(username);
  await admin.getByPlaceholder("Password").fill("operator-pass-1");
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin.getByTestId("admin-search")).toBeVisible({
    timeout: 30_000,
  });
  return { admin, context };
}

async function openShop(admin: Page, shopName: string, tab: string) {
  await admin.goto("/admin?tab=shops");
  await admin.getByTestId("admin-search").fill(shopName);
  await admin.getByRole("button", { name: "Search" }).click();
  const row = admin.getByTestId("admin-shop-row").filter({ hasText: shopName });
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: shopName }).click();
  await admin.getByRole("tab", { name: tab }).click();
}

test("a shop whose subscription ran out is sent to billing, pays, is let in, and the operator approves", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;
  const shopName = `Billing Test ${stamp}`;
  await signUp(page, `bil${stamp}`, shopName);

  // A new shop starts on the trial: the sidebar says so.
  if (testInfo.project.name === "desktop")
    await expect(page.getByTestId("billing-card-state")).toHaveText(
      "ফ্রি ট্রায়াল",
      { timeout: 30_000 },
    );

  // The operator ends the period yesterday, with no grace days: the shop is locked.
  const { admin, context } = await operator(browser, testInfo, stamp);
  await openShop(admin, shopName, "Billing");
  await expect(admin.getByTestId("admin-shop-billing")).toBeVisible();
  await admin.getByTestId("admin-grace").fill("0");
  await admin.getByTestId("admin-save-plan").click();
  await expect(admin.getByTestId("admin-billing-message")).toHaveText(
    "Plan saved.",
  );
  await admin.getByTestId("admin-until").fill(dhakaDay(-1));
  await admin.getByTestId("admin-set-until").click();
  await expect(admin.getByTestId("admin-billing-message")).toHaveText(
    "End date set.",
  );

  // Every screen goes to billing; the server refuses the shop's data but keeps sync open.
  await page.goto("/pos");
  await expect(page).toHaveURL(/\/billing$/, { timeout: 60_000 });
  await expect(page.getByTestId("billing-locked")).toBeVisible();
  expect((await page.request.get("/api/data/products")).status()).toBe(402);
  expect((await page.request.get("/api/sync/head")).status()).toBe(200);
  // Every other way into the shop's data is closed too: reading, saving and the reports.
  for (const path of ["/api/dashboard", "/api/audit", "/api/reports/stock"])
    expect((await page.request.get(path)).status(), path).toBe(402);
  const save = await page.request.post("/api/commands", {
    data: {
      operationId: "00000000-0000-4000-8000-000000000000",
      type: "category.create",
      input: {},
    },
  });
  expect(save.status(), "saving").toBe(402);
  // ...while the people can still be listed and the billing page still answers (to pay).
  expect((await page.request.get("/api/staff")).status()).toBe(200);
  expect((await page.request.get("/api/billing")).status()).toBe(200);
  await page.goto("/products");
  await expect(page).toHaveURL(/\/billing$/, { timeout: 30_000 });

  // The owner sends the TrxID: the shop is let in while it is checked.
  await expect(page.getByTestId("billing-pay")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("billing-pay-number")).toHaveText(
    "01772998823",
  );
  // Unique every run: the test database keeps its data between runs, and the same TrxID cannot be
  // sent twice. (It used the last characters of the shop's stamp, which ends in the project name,
  // so only two digits changed from run to run and it clashed now and then.)
  const trxId =
    `T${Date.now().toString().slice(-9)}${testInfo.project.name[0]}`.toUpperCase();
  await page.locator("#billing-trx").fill(trxId);
  await page.locator("#billing-sender").fill("01711000001");
  await page.getByTestId("billing-submit").click();
  await expect(page.getByTestId("billing-sent")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("billing-locked")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByTestId("billing-payment").first()).toContainText(
    trxId,
  );
  await page.goto("/pos");
  await expect(page).toHaveURL(/\/pos$/);

  // The same TrxID cannot be sent twice.
  await page.goto("/billing");
  await page.locator("#billing-trx").fill(trxId);
  await page.locator("#billing-sender").fill("01711000001");
  await page.getByTestId("billing-submit").click();
  await expect(
    page.getByTestId("billing-pay").getByRole("alert"),
  ).toContainText("এই ট্রানজেকশন আইডি আগেই ব্যবহার হয়েছে");

  // The operator approves it from the queue: the period moves on a month from today.
  await admin.goto("/admin?tab=payments");
  const row = admin.getByTestId("admin-payment-row").filter({ hasText: trxId });
  await expect(row).toHaveCount(1);
  await row.getByTestId("admin-approve").click();
  await admin.getByTestId("admin-approve-confirm").click();
  await expect(row).toHaveCount(0);

  await page.goto("/billing");
  await expect(page.getByTestId("billing-state")).toHaveText("চালু", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("billing-payment").first()).toContainText(
    "অনুমোদিত",
  );
  expect((await page.request.get("/api/data/products")).status()).toBe(200);

  // The log has it.
  await admin.goto("/admin?tab=activity");
  await expect(admin.getByTestId("admin-activity")).toContainText(
    "billing.approve",
  );
  await context.close();
});

test("a device with no internet locks itself on the day the period ends", async ({
  page,
  browser,
  context,
}, testInfo) => {
  test.skip(
    E2E_MODE === "online",
    "an online-mode device cannot open without internet anyway",
  );
  test.setTimeout(240_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;
  const shopName = `Offline Lock ${stamp}`;
  await signUp(page, `bol${stamp}`, shopName);

  // The period ends tomorrow (no grace days); the device hears it while online.
  const operatorSide = await operator(browser, testInfo, `x${stamp}`);
  await openShop(operatorSide.admin, shopName, "Billing");
  await operatorSide.admin.getByTestId("admin-grace").fill("0");
  await operatorSide.admin.getByTestId("admin-save-plan").click();
  await expect(
    operatorSide.admin.getByTestId("admin-billing-message"),
  ).toHaveText("Plan saved.");
  await operatorSide.admin.getByTestId("admin-until").fill(dhakaDay(1));
  await operatorSide.admin.getByTestId("admin-set-until").click();
  await expect(
    operatorSide.admin.getByTestId("admin-billing-message"),
  ).toHaveText("End date set.");
  await operatorSide.context.close();

  await page.goto("/billing");
  await expect(page.getByTestId("billing-left")).toBeVisible({
    timeout: 60_000,
  });
  await appReadyOffline(page);

  // Three days later, with no internet: the device knows on its own.
  await context.setOffline(true);
  await page.clock.install({ time: new Date(Date.now() + 3 * 86_400_000) });
  await page.goto("/pos");
  await expect(page).toHaveURL(/\/billing$/, { timeout: 60_000 });
  await expect(page.getByTestId("billing-locked")).toBeVisible();
  await context.setOffline(false);
});
