import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../http";
import { checkRateLimit, resetRateLimits } from "../rate-limit";

vi.mock("server-only", () => ({}));

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("RATE_LIMIT_READ_PER_MIN", "3");
  vi.stubEnv("RATE_LIMIT_WRITE_PER_MIN", "2");
  vi.stubEnv("E2E_DISABLE_RATE_LIMIT", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("per-device request limit", () => {
  it("lets a device make its allowance, then refuses with 429", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("dev-1", "read", 1_000);
    try {
      checkRateLimit("dev-1", "read", 2_000);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(429);
    }
  });

  it("counts reads and writes separately, and each device on its own", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("dev-1", "read", 1_000);
    expect(() => checkRateLimit("dev-1", "write", 1_000)).not.toThrow();
    expect(() => checkRateLimit("dev-2", "read", 1_000)).not.toThrow();
  });

  it("starts again after a minute", () => {
    for (let i = 0; i < 3; i++) checkRateLimit("dev-1", "read", 1_000);
    expect(() => checkRateLimit("dev-1", "read", 61_001)).not.toThrow();
  });

  it("can be switched off for the test server", () => {
    vi.stubEnv("E2E_DISABLE_RATE_LIMIT", "1");
    for (let i = 0; i < 50; i++)
      expect(() => checkRateLimit("dev-1", "write", 1_000)).not.toThrow();
  });
});
