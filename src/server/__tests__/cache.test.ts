import { describe, expect, it, vi } from "vitest";
import { TtlCache } from "../cache";

describe("TtlCache", () => {
  it("keeps a value until it expires", () => {
    const cache = new TtlCache<string>(1_000);
    cache.set("a", "x", 0);
    expect(cache.get("a", 999)).toBe("x");
    expect(cache.get("a", 1_000)).toBeUndefined();
  });

  it("loads once for many callers at the same time", async () => {
    const cache = new TtlCache<string>(10_000);
    const load = vi.fn(async () => "found");
    const results = await Promise.all([
      cache.load("k", load),
      cache.load("k", load),
      cache.load("k", load),
    ]);
    expect(results).toEqual(["found", "found", "found"]);
    expect(load).toHaveBeenCalledTimes(1);
    // And afterwards it comes from memory.
    await cache.load("k", load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not remember 'not there', so something created later is seen at once", async () => {
    const cache = new TtlCache<string>(10_000);
    const load = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("now there");
    expect(await cache.load("k", load)).toBeUndefined();
    expect(await cache.load("k", load)).toBe("now there");
  });

  it("forgets on delete and clear", async () => {
    const cache = new TtlCache<string>(10_000);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    cache.clear();
    expect(cache.get("b")).toBeUndefined();
  });

  it("never grows past its limit", () => {
    const cache = new TtlCache<number>(10_000, 3);
    for (let i = 0; i < 10; i++) cache.set(`k${i}`, i, 0);
    let present = 0;
    for (let i = 0; i < 10; i++)
      if (cache.get(`k${i}`, 1) !== undefined) present++;
    expect(present).toBeLessThanOrEqual(3);
  });
});
