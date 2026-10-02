/**
 * The suite runs in either data mode: `E2E_MODE=online npx playwright test` makes every browser
 * (every device a test creates) start in online mode; by default devices start offline, the way
 * most of these tests are written. (The app's own default for a new device is online; the mode
 * switch tests start from that.) A device remembers its mode in localStorage, so setting it up
 * front is enough.
 */
export const E2E_MODE =
  process.env.E2E_MODE === "online" ? "online" : "offline";

/** Storage state that pre-sets the mode for a browser context (undefined when the default is wanted). */
export function modeStorageState(baseURL: string) {
  return E2E_MODE
    ? {
        cookies: [],
        origins: [
          {
            origin: new URL(baseURL).origin,
            localStorage: [{ name: "sa.dataMode", value: E2E_MODE }],
          },
        ],
      }
    : undefined;
}

/** Options for an extra device (a second phone or computer) a test creates. */
export function deviceOptions(baseURL: string | undefined) {
  const url = baseURL ?? "http://localhost:3100";
  return { locale: "bn-BD", baseURL: url, storageState: modeStorageState(url) };
}

/** Storage state for a device that starts in this mode (for specs about switching between them). */
export function startingIn(mode: "online" | "offline") {
  const origin = `http://localhost:${process.env.E2E_PORT ?? 3100}`;
  return {
    cookies: [],
    origins: [{ origin, localStorage: [{ name: "sa.dataMode", value: mode }] }],
  };
}
