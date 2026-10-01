import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
    // Timing tests run on their own: see `pnpm test:perf`.
    exclude: ["**/node_modules/**", "**/*.perf.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 20_000,
  },
});
