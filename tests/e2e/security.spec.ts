import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

test("security headers are sent and the app runs under them without violations", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get("/login");
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();

  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy|refused to/i.test(message.text()))
      violations.push(message.text());
  });
  page.on("pageerror", (error) => violations.push(error.message));

  await signUp(page, `sec${Date.now()}${testInfo.project.name}`);
  for (const path of [
    "/dashboard",
    "/pos",
    "/products",
    "/reports",
    "/settings",
    "/settings/staff",
    "/sync",
  ]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(violations).toEqual([]);
});

test("private endpoints refuse visitors who are not signed in", async ({
  request,
}) => {
  for (const path of [
    "/api/staff",
    "/api/devices",
    "/api/audit",
    "/api/reports/summary?from=2026-10-01&to=2026-10-02",
  ]) {
    const response = await request.get(path);
    expect([401, 403], path).toContain(response.status());
  }
  const push = await request.post("/api/sync/push", {
    data: { deviceId: "x", appVersion: "1", ops: [] },
  });
  expect([400, 401, 403]).toContain(push.status());
  const pull = await request.get("/api/sync/pull?cursor=0");
  expect([400, 401, 403]).toContain(pull.status());
  const pin = await request.put("/api/staff/abc/pin", { data: {} });
  expect([401, 403]).toContain(pin.status());
});

test("the PIN unlock endpoint needs a registered device and checks who is asking", async ({
  page,
  request,
}, testInfo) => {
  // No device cookie: refused.
  const anonymous = await request.post("/api/actor/unlock", {
    data: { userId: "x", pin: "1234" },
  });
  expect(anonymous.status()).toBe(401);
  expect((await anonymous.json()).code).toBe("DEVICE_UNKNOWN");

  // A registered device (signing in registers it): an unknown person is refused, and so is junk.
  await signUp(page, `act${Date.now()}${testInfo.project.name}`);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const r = await fetch("/api/actor/unlock", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "nobody", pin: "1234" }),
        });
        return `${r.status} ${(await r.json()).code}`;
      }),
    )
    .toBe("401 UNKNOWN_USER");
  const junk = await page.evaluate(async () => {
    const r = await fetch("/api/actor/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: 5 }),
    });
    return r.status;
  });
  expect(junk).toBe(400);

  // Locking always works and clears the cookie.
  const lock = await page.evaluate(
    async () => (await fetch("/api/actor/lock", { method: "POST" })).status,
  );
  expect(lock).toBe(200);
});
