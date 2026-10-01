import { describe, expect, it } from "vitest";
import { newId } from "../ids";

describe("ids", () => {
  it("generates unique, time-sortable v7 ids", async () => {
    const a = newId();
    await new Promise((r) => setTimeout(r, 3));
    const b = newId();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, newId)).size).toBe(1000);
  });
});
