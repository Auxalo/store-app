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
