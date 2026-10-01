import { defineConfig, devices } from "@playwright/test";

// Uses the system Chrome/Edge so no browser download is needed. Override with PW_CHANNEL.
const channel = process.env.PW_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel,
    trace: "retain-on-failure",
    // Bangla is the default UI language; tests assert both languages explicitly.
    locale: "bn-BD",
    timezoneId: "Asia/Dhaka",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], channel } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
  ],
  webServer: {
    // Offline behaviour must be tested against a production build (the dev server has no precache).
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 240_000,
  },
});
