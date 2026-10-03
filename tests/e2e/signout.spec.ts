import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("signing out ends the session: the sign-in page stays, a reload and the app's own pages send you back to it", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  await signUp(page, `out${Date.now()}${testInfo.project.name}`);

  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByRole("menuitem", { name: "সাইন আউট" }).click();
  // Changes still on their way to the cloud ask for a confirmation first.
  const confirm = page.getByRole("button", { name: "তবুও সাইন আউট" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

  // The server has ended the session, not just this screen.
  expect((await page.request.get("/api/stores/current")).status()).toBe(401);
  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name.includes("session_token") && c.value)).toBe(
    false,
  );

  // Nothing bounces back into the app: not after a moment, not after a reload.
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
  await expect(page.getByLabel("পাসওয়ার্ড")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/login$/);

  // And the app's own pages send a signed-out person to the sign-in page.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
});

test("when the server refuses the sign-out the person is told and stays signed in, not sent back in silently", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signUp(page, `ref${Date.now()}${testInfo.project.name}`);
  await page.route("**/api/auth/sign-out", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "boom" }),
    }),
  );

  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByRole("menuitem", { name: "সাইন আউট" }).click();
  const confirm = page.getByRole("button", { name: "তবুও সাইন আউট" });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();

  await expect(page.getByText("সাইন আউট করা যায়নি")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/dashboard$/);
  // Still signed in, so a second try (the server answering this time) works.
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "অ্যাকাউন্ট" }).click();
  await page.getByRole("menuitem", { name: "সাইন আউট" }).click();
  const again = page.getByRole("button", { name: "তবুও সাইন আউট" });
  if (await again.isVisible().catch(() => false)) await again.click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
});

test("the sign-out is accepted when the app is opened on another address than the configured one, and still refused from another site", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.setTimeout(120_000);
  await signUp(page, `adr${Date.now()}${testInfo.project.name}`);
  const cookie = (await context.cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  // Another site asking (a forged request) is refused, and the session survives it.
  const forged = await page.request.post("/api/auth/sign-out", {
    headers: { origin: "https://other.example.com" },
    data: {},
  });
  expect(forged.status()).toBe(403);
  expect((await page.request.get("/api/stores/current")).status()).toBe(200);

  // The same server reached by another address, with that address as the origin (what a Vercel
  // preview or alias looks like to a server configured for one address): accepted.
  const other = new URL(baseURL as string);
  other.hostname = "127.0.0.1";
  const viaOther = await page.request.post(
    `${other.origin}/api/auth/sign-out`,
    {
      headers: { origin: other.origin, cookie },
      data: {},
    },
  );
  expect(viaOther.status()).toBe(200);
  // ...and it tells the browser to drop the session cookie.
  expect(viaOther.headers()["set-cookie"]).toMatch(/session_token=;/);
});
