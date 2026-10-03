import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "@/commands/local/run";
import { getLocalDb } from "@/db/local/db";
import { getDeviceId } from "@/db/local/meta";
import { newId } from "@/lib/ids";

/**
 * The background sync loop against a server that always answers "this shop is paused". What
 * matters: it asks again after a long wait, not every second (it used to, for as long as the shop
 * stayed paused).
 */
const calls = { register: 0, push: 0, pull: 0 };

beforeEach(() => {
  calls.register = calls.push = calls.pull = 0;
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), { visibilityState: "visible" }),
  );
  vi.stubGlobal("fetch", async (input: string) => {
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status });
    if (input.startsWith("/api/devices/register")) {
      calls.register++;
      return json(200, { code: "A" });
    }
    if (input.startsWith("/api/sync/push")) calls.push++;
    if (input.startsWith("/api/sync/pull")) calls.pull++;
    return json(403, { code: "SHOP_SUSPENDED" });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the sync loop of a device whose shop is paused", () => {
  it("does not ask the server again every second", async () => {
    const { startSyncManager } = await import("../manager");
    const db = getLocalDb();
    const deviceId = await getDeviceId(db);
    await runCommand(
      db,
      { storeId: "s1", actorUserId: "u1", role: "owner", deviceId },
      "category.create",
      { id: newId(), name: "Waiting" },
    );

    const stop = startSyncManager({ storeId: "s1" });
    await sleep(3_800);
    stop();

    // The first try is answered "paused" (and the device registered); the next waits a minute.
    // Before the fix there was one more every second: three or four in this time.
    expect(calls.register).toBeGreaterThanOrEqual(1);
    expect(calls.push).toBe(1);
  }, 15_000);
});
