import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test.afterEach(async ({ page }) => {
  await page.goto("about:blank").catch(() => undefined);
});

/**
 * Size budgets for the pages people open all day, measured as the JavaScript a phone downloads the
 * first time (compressed, as sent over the network). If a change pushes a page past its budget, this
 * fails, so the app does not quietly get heavier on cheap phones and slow connections.
 */
// Measured at the end of Sprint 3: login 373, app pages 503-527 on a phone and up to 540 on a desktop
// (the sidebar loads too). Each budget is the largest measurement plus about 20 KB. The sign-in
// page grew by about 24 KB during Sprint 2 and 3 (more strings, the data layer's small shared
// pieces); worth trimming later.
// Raised by about 15 KB after the signing of offline work (src/auth/op-proof.ts and its hashing
// library), the PIN rules, and the usability pass: measured 373 / 544 / 552 / 555 / 555 on a desktop.
const BUDGET_KB: Record<string, number> = {
  "/login": 395,
  "/pos": 560,
  "/dashboard": 568,
  "/reports": 570,
  "/products": 570,
};

test("first-load JavaScript stays within budget", async ({
  browser,
  baseURL,
}, testInfo) => {
  const sizes: Record<string, number> = {};
  const seeder = await browser.newContext({
    baseURL: baseURL ?? undefined,
    locale: "bn-BD",
  });
  const seed = await seeder.newPage();
  await signUp(seed, `bud${Date.now()}${testInfo.project.name}`);
  const state = await seeder.storageState();
  await seeder.close();

  for (const path of Object.keys(BUDGET_KB)) {
    // A new visitor each time: nothing cached, service worker not yet in charge.
    const context = await browser.newContext({
      baseURL: baseURL ?? undefined,
      locale: "bn-BD",
      storageState: path === "/login" ? undefined : state,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    let bytes = 0;
    page.on("response", async (response) => {
      if (response.request().resourceType() !== "script") return;
      const sizeInfo = await response
        .request()
        .sizes()
        .catch(() => null);
      bytes += sizeInfo?.responseBodySize ?? 0;
    });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    sizes[path] = Math.round(bytes / 1024);
    await context.close();
  }
  console.log("first-load JS (KB, compressed):", JSON.stringify(sizes));
  for (const [path, budget] of Object.entries(BUDGET_KB)) {
    expect(sizes[path], `${path} first-load JS`).toBeLessThanOrEqual(budget);
  }
});
