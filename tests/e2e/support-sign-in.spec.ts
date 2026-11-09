import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
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

function createOperator(username: string, password: string) {
  execFileSync(
    "node",
    [
      "scripts/create-admin.mjs",
      "--name",
      "Support",
      "--username",
      username,
      "--password",
      password,
      "--yes",
    ],
    { env, stdio: "pipe" },
  );
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(username);
  await page.getByLabel("পাসওয়ার্ড").fill(password);
  await page.getByRole("button", { name: "সাইন ইন", exact: true }).click();
}

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

test("the operator opens a shop with its username and an operator password; it is logged", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;
  const owner = `sup${stamp}`;
  await signUp(page, owner, `Support Test ${stamp}`);

  const operator = `supop${stamp}`;
  const operatorPass = `support-pass-${stamp}`;
  createOperator(operator, operatorPass);
  const other = `supop2${stamp}`;
  createOperator(other, `other-pass-${stamp}`);

  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
  });
  const support = await context.newPage();

  // A wrong password is still refused, the same way as always.
  await login(support, owner, "not-the-password");
  await expect(support.locator("form [role=alert]")).toContainText(
    "ইউজারনেম বা পাসওয়ার্ড",
  );

  // Another operator's account is never opened with an operator password.
  await login(support, other, operatorPass);
  await expect(support.locator("form [role=alert]")).toBeVisible();
  await expect(support).toHaveURL(/\/login$/);

  // The shop's username with the operator's password opens the shop.
  await login(support, owner, operatorPass);
  await expect(support).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  // Signed in as the shop owner (the shop name is in the sidebar, hidden on a phone).
  const session = (await (
    await support.request.get("/api/auth/get-session")
  ).json()) as { user: { username: string; storeId: string } };
  expect(session.user.username).toBe(owner);

  // Chrome is told not to offer translating the app (it has its own Bangla and English).
  await expect(support.locator("html")).toHaveAttribute("translate", "no");
  await expect(support.locator("meta[name=google]")).toHaveAttribute(
    "content",
    "notranslate",
  );

  // The session ends with the browser: its cookie has no expiry date.
  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name.endsWith("session_token"));
  expect(sessionCookie?.expires).toBe(-1);
  await context.close();

  // The operator sees it in the operator log.
  const adminContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    locale: "en-US",
  });
  const admin = await adminContext.newPage();
  await admin.goto("/admin?tab=shops");
  await admin.getByPlaceholder("Username").fill(operator);
  await admin.getByPlaceholder("Password").fill(operatorPass);
  await admin.getByRole("button", { name: "Sign in" }).click();
  await expect(admin.getByTestId("admin-sign-out")).toBeVisible();
  const audit = (await (
    await admin.request.get("/api/admin/audit")
  ).json()) as {
    actions: Array<{ action: string; detail: string; adminName: string }>;
  };
  expect(
    audit.actions.some(
      (a) => a.action === "support.sign_in" && a.detail === `@${owner}`,
    ),
  ).toBe(true);
  await adminContext.close();
});
