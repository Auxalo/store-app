/**
 * QA audit, part 2: who may do what, seen through the browser (findings H1, M2, M10, M11).
 * See docs/QA-REPORT.md.
 */
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { addCashier, indicator, signUp } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

const dbPort = Number(process.env.DEV_DB_PORT ?? 27018);
const env = {
  ...process.env,
  MONGODB_URI:
    process.env.E2E_MONGODB_URI ??
    `mongodb://127.0.0.1:${dbPort}/?replicaSet=rs0`,
  MONGODB_DB: process.env.E2E_MONGODB_DB ?? "store_app_e2e",
};

async function tapPin(page: Page, pin: string) {
  for (const digit of pin) await page.getByTestId(`pin-${digit}`).click();
  await page.getByTestId("pin-submit").click();
}

async function switchUser(page: Page) {
  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByTestId("switch-user").click();
  await expect(page.getByTestId("lock-screen")).toBeVisible();
}

const A_PIN_HASH = {
  salt: `${"A".repeat(22)}==`,
  hash: `${"A".repeat(43)}=`,
};

/** An owner with a cashier (who has a PIN), and the cashier now working at the counter. */
async function counterWithCashier(page: Page, stamp: string) {
  await signUp(page, `qasec${stamp}`);
  await addCashier(page, "সাবিনা", `qacs${stamp}`, "1234");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });
  const staff = (await (await page.request.get("/api/staff")).json()) as {
    staff: Array<{ id: string; role: string; name: string }>;
  };
  const ownerId = staff.staff.find((s) => s.role === "owner")?.id as string;
  const cashierId = staff.staff.find((s) => s.role === "cashier")?.id as string;
  expect(ownerId && cashierId).toBeTruthy();

  await switchUser(page);
  await page.getByTestId("lock-user").filter({ hasText: "সাবিনা" }).click();
  await tapPin(page, "1234");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0, {
    timeout: 20_000,
  });
  // The server is told who is working a moment after the PIN: wait for that.
  await expect
    .poll(async () => (await page.request.get("/api/data/products")).status(), {
      timeout: 30_000,
    })
    .toBe(200);
  return { ownerId, cashierId };
}

test("QA H1: on a shared counter a cashier cannot manage staff, devices or the audit log with the owner's sign-in", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;
  const { ownerId, cashierId } = await counterWithCashier(page, stamp);

  // Take over the owner's account with a new password.
  const password = await page.request.patch(`/api/staff/${ownerId}`, {
    data: { password: "hacked12345" },
  });
  expect(password.status(), "change the owner's password").toBe(403);
  // Choose the owner's PIN.
  const pin = await page.request.put(`/api/staff/${ownerId}/pin`, {
    data: A_PIN_HASH,
  });
  expect(pin.status(), "set the owner's PIN").toBe(403);
  // Promote themselves.
  const role = await page.request.patch(`/api/staff/${cashierId}`, {
    data: { role: "manager" },
  });
  expect(role.status(), "become a manager").toBe(403);
  // Read the audit log and the list of devices.
  expect((await page.request.get("/api/audit")).status(), "audit log").toBe(
    403,
  );
  expect((await page.request.get("/api/devices")).status(), "devices").toBe(
    403,
  );

  // Their own PIN is still theirs to change.
  const own = await page.request.put(`/api/staff/${cashierId}/pin`, {
    data: A_PIN_HASH,
  });
  expect(own.status(), "set their own PIN").toBe(200);
});

test("QA M2: after signing out, the person who was working is forgotten by the server", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;
  await counterWithCashier(page, stamp);
  // While working, the shop's data answers (the server is told who is working a moment after the PIN).
  await expect
    .poll(async () => (await page.request.get("/api/data/products")).status(), {
      timeout: 20_000,
    })
    .toBe(200);

  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByRole("menuitem", { name: "সাইন আউট" }).click();
  const confirm = page.getByRole("button", { name: "তবুও সাইন আউট" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

  // The device is still known, but nobody is working on it any more.
  const after = await page.request.get("/api/data/products");
  expect([401, 403]).toContain(after.status());
});

test("QA M10: an operator account cannot use a shop's staff endpoints", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const username = `qaop${Date.now()}${testInfo.project.name}`;
  execFileSync(
    "node",
    [
      "scripts/create-admin.mjs",
      "--name",
      "QA Operator",
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
  const page = await context.newPage();
  await page.goto("/admin?tab=shops");
  await page.getByPlaceholder("Username").fill(username);
  await page.getByPlaceholder("Password").fill("operator-pass-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("admin-search")).toBeVisible({
    timeout: 30_000,
  });

  // The operator is an "owner" of the pseudo shop "platform": its endpoints must not answer.
  const staff = await page.request.get("/api/staff");
  expect([401, 403]).toContain(staff.status());
  const list = await page.request.get("/api/audit");
  expect([401, 403]).toContain(list.status());
  await context.close();
});

test("QA M11: nobody can rename themselves through the sign-in service", async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  const stamp = `${Date.now()}${testInfo.project.name}`;
  await signUp(page, `qaren${stamp}`);
  const rename = await page.request.post("/api/auth/update-user", {
    headers: { origin: baseURL as string },
    data: { name: "Somebody Else" },
  });
  expect(rename.ok(), `update-user answered ${rename.status()}`).toBe(false);
});
