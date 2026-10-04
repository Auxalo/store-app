import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

/** The test server's own database (never the one in .env.local). */
const dbPort = Number(process.env.DEV_DB_PORT ?? 27018);
const env = {
  ...process.env,
  MONGODB_URI:
    process.env.E2E_MONGODB_URI ??
    `mongodb://127.0.0.1:${dbPort}/?replicaSet=rs0`,
  MONGODB_DB: process.env.E2E_MONGODB_DB ?? "store_app_e2e",
};

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

test("an operator pauses, backs up and resets a shop; the shop cannot reach the operator panel", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;
  const owner = `own${stamp}`;
  const shopName = `Paused Test ${stamp}`;
  await signUp(page, owner, shopName);

  // A shop's own sign-in is not an operator, and nobody signed out gets in either.
  expect((await page.request.get("/api/admin/shops")).status()).toBe(403);
  const anonymous = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  expect((await anonymous.request.get("/api/admin/shops")).status()).toBe(401);
  await anonymous.close();

  // Make an operator account, the way the operator does (the command-line tool).
  const operator = `op${stamp}`;
  execFileSync(
    "node",
    [
      "scripts/create-admin.mjs",
      "--name",
      "Operator",
      "--username",
      operator,
      "--password",
      "operator-pass-1",
      "--yes",
    ],
    { env, stdio: "pipe" },
  );

  const adminContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "en-US",
  });
  const admin = await adminContext.newPage();
  await admin.goto("/admin?tab=shops");
  await admin.getByPlaceholder("Username").fill(operator);
  await admin.getByPlaceholder("Password").fill("operator-pass-1");
  await admin.getByRole("button", { name: "Sign in" }).click();

  // Find the shop and open it.
  await admin.getByTestId("admin-search").fill(shopName);
  await admin.getByRole("button", { name: "Search" }).click();
  const row = admin.getByTestId("admin-shop-row").filter({ hasText: shopName });
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: shopName }).click();
  await expect(admin.getByTestId("admin-shop-status")).toHaveText("Active");
  const shopId = new URL(admin.url()).searchParams.get("id") as string;

  // Pause it: its devices are refused and the app says who to contact.
  await admin.getByTestId("admin-toggle").click();
  await admin.getByTestId("admin-confirm").click();
  await expect(admin.getByTestId("admin-shop-status")).toHaveText("Paused");
  await page.reload();
  await expect(page.getByTestId("suspended-screen")).toBeVisible({
    timeout: 40_000,
  });
  await expect(page.getByTestId("suspended-screen")).toContainText(
    "Sohel Ashik",
  );

  // Resume it: the shop is back.
  await admin.getByTestId("admin-toggle").click();
  await admin.getByTestId("admin-confirm").click();
  await expect(admin.getByTestId("admin-shop-status")).toHaveText("Active");
  await page.reload();
  await expect(page.getByTestId("suspended-screen")).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

  // A backup holds this shop and no other.
  const backup = await admin.request.get(`/api/admin/shops/${shopId}/export`);
  expect(backup.status()).toBe(200);
  const text = await backup.text();
  expect(text.split("\n")[0]).toContain(shopId);
  expect(text).toContain(shopName);
  expect(text).toContain(owner);
  expect(
    text.match(/"storeId":"[^"]+"/g)?.every((m) => m.includes(shopId)),
  ).toBe(true);

  // The owner's password can be reset; the old one stops working, the new one signs in.
  await admin.getByTestId("admin-reset").click();
  await admin
    .getByPlaceholder("New password (8+ characters)")
    .fill("brand-new-pass-1");
  await admin.getByTestId("admin-reset-confirm").click();
  await expect(admin.getByTestId("admin-message")).toContainText(
    "password was changed",
  );

  const fresh = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "bn-BD",
  });
  const login = await fresh.newPage();
  await login.goto("/login");
  await login.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(owner);
  await login.getByLabel("পাসওয়ার্ড").fill("password123");
  await login.getByRole("button", { name: "সাইন ইন", exact: true }).click();
  await expect(login).toHaveURL(/\/login$/); // the old password no longer works
  await login.getByLabel("পাসওয়ার্ড").fill("brand-new-pass-1");
  await login.getByRole("button", { name: "সাইন ইন", exact: true }).click();
  await expect(login).toHaveURL(/\/(dashboard|pos|settings\/setup)$/, {
    timeout: 30_000,
  });

  // What the operator did is on record.
  await admin.goto("/admin");
  await admin.getByRole("tab", { name: "Activity" }).click();
  await expect(admin.getByTestId("admin-activity")).toContainText(
    "shop.suspend",
  );
  await expect(admin.getByTestId("admin-activity")).toContainText(
    "shop.export",
  );

  // The operator can sign out, and the panel asks for a sign-in again.
  await admin.getByTestId("admin-sign-out").click();
  await expect(admin.getByTestId("admin-gate")).toBeVisible();
  expect((await admin.request.get("/api/admin/shops")).status()).toBe(401);
  await fresh.close();
  await adminContext.close();
});
