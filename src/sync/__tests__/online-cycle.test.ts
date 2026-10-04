import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataError } from "@/data/errors";
import { forgetHead, setHead } from "@/data/head";
import { StoreDB } from "@/db/local/db";

const fetchAll = vi.fn();
vi.mock("@/data/online", () => ({
  fetchAll: (...args: unknown[]) => fetchAll(...args),
}));

const { syncOnlineOnce } = await import("../online-cycle");
const { useSyncStore } = await import("../store");
const { TransportError } = await import("../transport");

const noTransport = {
  push: () => Promise.reject(new Error("nothing is queued")),
  pull: () => Promise.reject(new Error("online mode does not pull")),
};
const options = { deviceId: "d1", appVersion: "1.0.0" };

let db: StoreDB;
beforeEach(() => {
  db = new StoreDB(`online-${randomUUID()}`);
  fetchAll.mockReset();
  fetchAll.mockResolvedValue([]);
  forgetHead();
  useSyncStore.getState().patch({ problem: null });
});

describe("the online sync cycle", () => {
  it("asks for nothing while all is well and the shop has not changed", async () => {
    setHead(5);
    await syncOnlineOnce(db, noTransport, options);
    await syncOnlineOnce(db, noTransport, options);
    expect(fetchAll).toHaveBeenCalledTimes(1);
  });

  it("asks the server every time while something is wrong, so a quiet cycle never clears it", async () => {
    setHead(7);
    await syncOnlineOnce(db, noTransport, options);
    useSyncStore.getState().patch({ problem: "suspended" });
    await syncOnlineOnce(db, noTransport, options);
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it("reports a paused shop as paused, not as a sign-in problem", async () => {
    setHead(9);
    fetchAll.mockRejectedValue(new DataError("SHOP_SUSPENDED", 403));
    const error = await syncOnlineOnce(db, noTransport, options).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TransportError);
    expect((error as InstanceType<typeof TransportError>).kind).toBe(
      "suspended",
    );
  });

  it("still reports other refusals as a sign-in problem", async () => {
    setHead(11);
    fetchAll.mockRejectedValue(new DataError("DEVICE_REVOKED", 403));
    const error = await syncOnlineOnce(db, noTransport, options).catch(
      (e: unknown) => e,
    );
    expect((error as InstanceType<typeof TransportError>).kind).toBe("auth");
  });
});
