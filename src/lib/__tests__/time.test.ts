import { describe, expect, it } from "vitest";
import { endOfStoreDay, startOfStoreDay } from "../time";

describe("store day boundaries", () => {
  it("uses Asia/Dhaka midnight (UTC+6)", () => {
    const at = new Date("2026-10-01T20:00:00Z"); // 02:00 on Oct 2 in Dhaka
    expect(startOfStoreDay(at).toISOString()).toBe("2026-10-01T18:00:00.000Z");
    expect(endOfStoreDay(at).toISOString()).toBe("2026-10-02T17:59:59.999Z");
  });
});
