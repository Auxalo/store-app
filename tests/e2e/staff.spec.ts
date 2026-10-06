import { expect, type Page, test } from "@playwright/test";
import {
  addCashier,
  addCategory,
  createProduct,
  indicator,
  openCart,
  search,
  signIn,
  signUp,
  tapProduct,
} from "./helpers";
import { deviceOptions, E2E_MODE } from "./mode";

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

test("owner adds a cashier with a PIN; the cashier unlocks offline and is limited", async ({
  page,
  context,
}, testInfo) => {
  const owner = `own${Date.now()}${testInfo.project.name}`;
  await signUp(page, owner);
  await addCashier(
    page,
    "সাবিনা",
    `cash${Date.now()}${testInfo.project.name}`,
    "1234",
  );

  // The owner is not thrown out when the first PIN appears.
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);
  await expect(page.getByTestId("owner-pin-hint")).toBeVisible();
  await expect(page.getByTestId("staff-list")).toContainText("পিন দেওয়া আছে");
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  // Lock the counter, lose the internet, and the cashier gets in with the PIN alone.
  await switchUser(page);
  await context.setOffline(true);
  await page.getByTestId("lock-user").filter({ hasText: "সাবিনা" }).click();
  await tapPin(page, "1234");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);

  // A cashier cannot open settings, and has no link to purchases.
  await expect(page.getByText("শুধু মালিক সেটিংস খুলতে পারেন।")).toBeVisible();
  await expect(page.locator('a[href="/purchases"]')).toHaveCount(0);
  await expect(page.locator('a[href="/pos"]').first()).toBeVisible();

  // Typing the address of a screen the role may not use shows "no access", not the shop's numbers.
  for (const path of ["/reports", "/dashboard", "/returns"]) {
    await page.goto(path);
    // A fresh page load locks the counter again.
    await page.getByTestId("lock-user").filter({ hasText: "সাবিনা" }).click();
    await tapPin(page, "1234");
    await expect(page.getByTestId("no-access")).toBeVisible({
      timeout: 15_000,
    });
  }
});

test("wrong PINs are counted, then the counter makes you wait", async ({
  page,
}, testInfo) => {
  const owner = `lock${Date.now()}${testInfo.project.name}`;
  await signUp(page, owner);
  await addCashier(
    page,
    "রুমা",
    `rum${Date.now()}${testInfo.project.name}`,
    "2468",
  );
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });
  await switchUser(page);
  await page.getByTestId("lock-user").filter({ hasText: "রুমা" }).click();

  for (let i = 0; i < 4; i++) await tapPin(page, "1111");
  await expect(page.getByTestId("lock-message")).toBeVisible();
  await expect(page.getByTestId("lock-screen")).toBeVisible();

  // The fifth mistake starts the waiting; even the right PIN is refused until it passes.
  await tapPin(page, "1111");
  await expect(page.getByTestId("lock-wait")).toBeVisible();
  await expect(page.getByTestId("pin-2")).toBeDisabled();
});

test("store name, address and footer appear on the receipt", async ({
  page,
}, testInfo) => {
  await signUp(page, `rcp${Date.now()}${testInfo.project.name}`);
  await createProduct(page, {
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    price: "50",
    stock: "10",
  });

  await page.goto("/settings");
  await page.getByTestId("store-name").fill("আলো স্টোর");
  await page.getByTestId("store-address").fill("মিরপুর, ঢাকা");
  await page.getByTestId("save-store").click();
  await page.getByTestId("receipt-footer").fill("আবার আসবেন");
  await page.getByTestId("save-footer").click();
  await expect(page.getByTestId("receipt-footer")).toHaveValue("আবার আসবেন");

  await page.goto("/pos");
  await search(page).fill("দুধ");
  await tapProduct(page, "ফ্রেশ দুধ");
  await openCart(page);
  await page.getByTestId("complete-sale").click();

  const receipt = page.locator("#print-receipt");
  await expect(receipt).toContainText("আলো স্টোর");
  await expect(receipt).toContainText("মিরপুর, ঢাকা");
  await expect(receipt).toContainText("আবার আসবেন");
});

test("a deactivated person cannot sign in; a cut-off device cannot sync", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    E2E_MODE === "online",
    "this is about the offline queue, which online mode does not use",
  );
  const owner = `adm${Date.now()}${testInfo.project.name}`;
  const cashier = `off${Date.now()}${testInfo.project.name}`;
  await signUp(page, owner);
  await addCashier(page, "জামাল", cashier);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  // Switch them off.
  await page
    .getByTestId("staff-row")
    .filter({ hasText: "জামাল" })
    .getByTestId("staff-edit")
    .click();
  await page.getByTestId("toggle-active").click();
  await page.getByTestId("confirm-deactivate").click();
  await expect(
    page.getByTestId("staff-row").filter({ hasText: "জামাল" }),
  ).toContainText("নিষ্ক্রিয়");

  const blocked = await browser.newContext(
    deviceOptions(testInfo.project.use.baseURL),
  );
  const loginPage = await blocked.newPage();
  await loginPage.goto("/login");
  await loginPage.getByLabel("মোবাইল নম্বর বা ইউজারনেম").fill(cashier);
  await loginPage.getByLabel("পাসওয়ার্ড").fill("password123");
  await loginPage.getByRole("button", { name: "সাইন ইন", exact: true }).click();
  await expect(loginPage.locator("p[role=alert]")).toBeVisible();
  await expect(loginPage).toHaveURL(/\/login$/);
  await blocked.close();

  // A second device joins, then the owner cuts it off.
  const second = await browser.newContext(
    deviceOptions(testInfo.project.use.baseURL),
  );
  const pageB = await second.newPage();
  await signIn(pageB, owner);
  await expect(indicator(pageB, "synced")).toBeVisible({ timeout: 20_000 });

  await page.goto("/settings/devices");
  await expect(page.getByTestId("device-row")).toHaveCount(2);
  await page
    .getByTestId("device-row")
    .filter({ hasNotText: "এই ডিভাইস" })
    .getByTestId("revoke-device")
    .click();
  await page.getByTestId("confirm-revoke").click();
  await expect(
    page.getByTestId("device-row").filter({ hasText: "বন্ধ করা" }),
  ).toHaveCount(1);

  // The cut-off device keeps its work but cannot send it.
  await pageB.goto("/categories");
  await pageB.getByRole("button", { name: "ক্যাটাগরি যোগ করুন" }).click();
  await pageB.getByLabel("নাম", { exact: true }).fill("দুগ্ধজাত");
  await pageB.getByLabel("বাংলা নাম").fill("দুগ্ধজাত");
  await pageB.getByRole("button", { name: "সংরক্ষণ" }).click();
  await expect(
    pageB.getByTestId("category-row").filter({ hasText: "দুগ্ধজাত" }),
  ).toBeVisible();
  await expect(indicator(pageB, "issue")).toBeVisible({ timeout: 30_000 });
  await second.close();
});

test("a manager's PIN is checked on this device only after they have entered it online here", async ({
  page,
  context,
}, testInfo) => {
  test.skip(E2E_MODE === "online", "offline-mode behaviour");
  const owner = `own${Date.now()}${testInfo.project.name}`;
  await signUp(page, owner);

  // The owner adds a manager with a PIN.
  await page.goto("/settings/staff");
  await page.getByTestId("add-staff").click();
  await page.getByTestId("staff-name").fill("মিতা");
  await page.getByTestId("staff-username").fill(`mgr${Date.now()}`);
  await page.getByTestId("staff-password").fill("password123");
  await page.getByTestId("staff-role").click();
  await page.getByRole("option", { name: "ম্যানেজার" }).click();
  await page.getByTestId("staff-pin-input").fill("482913");
  await page.getByTestId("save-staff").click();
  await expect(
    page.getByTestId("staff-row").filter({ hasText: "মিতা" }),
  ).toBeVisible();
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });

  // With no internet, this device cannot check her PIN yet: it does not hold her PIN hash.
  await switchUser(page);
  await context.setOffline(true);
  await page.getByTestId("lock-user").filter({ hasText: "মিতা" }).click();
  await tapPin(page, "482913");
  await expect(page.getByTestId("lock-message")).toBeVisible();
  await expect(page.getByTestId("lock-screen")).toBeVisible();

  // Online, the server checks it, she is in, and the device may keep her hash from then on.
  await context.setOffline(false);
  await page
    .getByTestId("lock-user")
    .filter({ hasText: "মিতা" })
    .click({
      timeout: 3_000,
    })
    .catch(() => undefined);
  await tapPin(page, "482913");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0, {
    timeout: 15_000,
  });

  // Next time, offline, her PIN works.
  await switchUser(page);
  await context.setOffline(true);
  await page.getByTestId("lock-user").filter({ hasText: "মিতা" }).click();
  await tapPin(page, "482913");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0, {
    timeout: 15_000,
  });
});

test("an owner's offline work is signed with their PIN and accepted; the same action unsigned is refused", async ({
  page,
  context,
}, testInfo) => {
  test.skip(E2E_MODE === "online", "offline-mode behaviour");
  const owner = `own${Date.now()}${testInfo.project.name}`;
  await signUp(page, owner);
  // The owner sets their own PIN, locks the counter and unlocks again (online).
  await page.goto("/settings/staff");
  await page
    .getByTestId("staff-row")
    .filter({ hasText: "মালিক" })
    .getByTestId("staff-pin")
    .click();
  await page.getByTestId("pin-input").fill("482913");
  await page.getByTestId("pin-confirm").fill("482913");
  await page.getByTestId("save-pin").click();
  await expect(page.getByTestId("pin-input")).toHaveCount(0);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 20_000 });
  await switchUser(page);
  await page.getByTestId("lock-user").filter({ hasText: "মালিক" }).click();
  await tapPin(page, "482913");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);

  // Without internet, the owner adds a category (an owner action).
  await page.goto("/categories");
  await page.getByTestId("lock-user").filter({ hasText: "মালিক" }).click();
  await tapPin(page, "482913");
  await context.setOffline(true);
  await addCategory(page, "Signed", "সাইন করা");
  await expect(page.getByText("Signed").first()).toBeVisible();

  // Back online, it reaches the server (nothing is refused).
  await context.setOffline(false);
  await expect(indicator(page, "synced")).toBeVisible({ timeout: 30_000 });

  // The same kind of action sent by hand without a signature, in the owner's name, is refused.
  const cookies = await context.cookies();
  const device = cookies.find((c) => c.name === "sa_device");
  const deviceId = decodeURIComponent(device?.value ?? "").split(".")[0];
  const staff = (await (await page.request.get("/api/staff")).json()) as {
    staff: Array<{ id: string; role: string }>;
  };
  const ownerId = staff.staff.find((s) => s.role === "owner")?.id;
  const response = await page.request.post("/api/sync/push", {
    data: {
      deviceId,
      appVersion: "999.0.0",
      ops: [
        {
          operationId: crypto.randomUUID(),
          type: "setting.set",
          schemaVersion: 1,
          payload: {
            key: "receipt.footer",
            value: "forged",
            baseVersion: 0,
          },
          actorUserId: ownerId,
          deviceId,
          createdAt: new Date().toISOString(),
        },
      ],
    },
  });
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    results: Array<{ status: string; error?: string }>;
  };
  expect(body.results[0]).toMatchObject({
    status: "rejected",
    error: "PROOF_REQUIRED",
  });
});

test("an owner with no PIN of their own is not locked out after staff get PINs and the owner signs in again", async ({
  page,
}, testInfo) => {
  const owner = `own${Date.now()}${testInfo.project.name}`;
  await signUp(page, owner);
  await addCashier(page, "সাবিনা", `cash${Date.now()}`, "1234");

  // The counter locks: only the cashier has a PIN, so the owner uses the password.
  await switchUser(page);
  await page.getByRole("button", { name: "পাসওয়ার্ড দিয়ে সাইন ইন" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, owner);

  // The owner is the working person again, so the server accepts what they do. Setting their own
  // PIN (the way out of being asked for a password every time) goes to the server and works.
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);
  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByTestId("set-my-pin").click();
  await page.getByTestId("pin-input").fill("482913");
  await page.getByTestId("pin-confirm").fill("482913");
  await page.getByTestId("save-pin").click();
  await expect(page.getByTestId("pin-input")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);

  // And the owner can now unlock by PIN like everyone else.
  await switchUser(page);
  await page.getByTestId("lock-user").filter({ hasText: "রহিম" }).click();
  await tapPin(page, "482913");
  await expect(page.getByTestId("lock-screen")).toHaveCount(0);
});
