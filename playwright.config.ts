import { defineConfig, devices } from "@playwright/test";
import { modeStorageState } from "./tests/e2e/mode";

// Uses the system Chrome/Edge so no browser download is needed. Override with PW_CHANNEL.
const channel = process.env.PW_CHANNEL ?? "chrome";

// Tests run against their OWN production server and their OWN local database, never the one in
// .env.local (which may be a real or shared cloud database), and never a dev server you have open
// on port 3000. Environment variables set here win over .env files.
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${port}`;
const dbPort = Number(process.env.DEV_DB_PORT ?? 27018);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    channel,
    // E2E_MODE=online (or offline) starts every browser in that data mode.
    storageState: modeStorageState(baseURL),
    trace: "retain-on-failure",
    // Bangla is the default UI language; tests assert both languages explicitly.
    locale: "bn-BD",
    timezoneId: "Asia/Dhaka",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], channel } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel } },
  ],
  webServer: [
    {
      // A local MongoDB replica set (reused if it is already running).
      command: "pnpm db:dev",
      port: dbPort,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // Offline behaviour must be tested against a production build (the dev server has no precache).
      command: `pnpm build && pnpm start --port ${port}`,
      url: `${baseURL}/login`,
      reuseExistingServer: true,
      env: {
        MONGODB_URI:
          process.env.E2E_MONGODB_URI ??
          `mongodb://127.0.0.1:${dbPort}/?replicaSet=rs0`,
        MONGODB_DB: process.env.E2E_MONGODB_DB ?? "store_app_e2e",
        BETTER_AUTH_URL: baseURL,
        // Tests sign in far more often than any person would; production keeps the limiter on.
        E2E_DISABLE_RATE_LIMIT: "1",
      },
      timeout: 300_000,
    },
  ],
});
