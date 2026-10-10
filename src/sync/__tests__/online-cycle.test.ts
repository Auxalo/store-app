import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataError } from "@/data/errors";
import { forgetHead, onHeadChange, setHead } from "@/data/head";
import { StoreDB } from "@/db/local/db";

const fetchAll = vi.fn();
const fetchHead = vi.fn();
vi.mock("@/data/online", () => ({
  fetchAll: (...args: unknown[]) => fetchAll(...args),
  fetchHead: () => fetchHead(),
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
  fetchHead.mockReset();
  fetchHead.mockResolvedValue(5);
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

  it('asks "has anything changed?" once per cycle, and fetches the settings again only when it moved', async () => {
    setHead(20);
    fetchHead.mockResolvedValue(20);
    await syncOnlineOnce(db, noTransport, options); // first: fetches the settings
    await syncOnlineOnce(db, noTransport, options); // same head: no settings
    fetchHead.mockResolvedValue(21); // someone saved
    await syncOnlineOnce(db, noTransport, options);
    expect(fetchHead).toHaveBeenCalledTimes(3);
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it("tells the screens when another device has saved (the head moved)", async () => {
    const heard: number[] = [];
    const stop = onHeadChange((h) => heard.push(h));
    setHead(30);
    fetchHead.mockResolvedValue(33);
    await syncOnlineOnce(db, noTransport, options);
    stop();
    expect(heard).toEqual([33]);
  });

  it("reports no connection while asking for the head as a network problem", async () => {
    fetchHead.mockRejectedValue(new DataError("OFFLINE", 0));
    const error = await syncOnlineOnce(db, noTransport, options).catch(
      (e: unknown) => e,
    );
    expect((error as InstanceType<typeof TransportError>).kind).toBe("network");
  });

  it("asks the server every time while something is wrong, so a quiet cycle never clears it", async () => {
    setHead(7);
    fetchHead.mockResolvedValue(7);
    await syncOnlineOnce(db, noTransport, options);
    useSyncStore.getState().patch({ problem: "suspended" });
    await syncOnlineOnce(db, noTransport, options);
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it("reports a paused shop as paused, not as a sign-in problem", async () => {
    setHead(9);
    fetchHead.mockResolvedValue(9);
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
    fetchHead.mockResolvedValue(11);
    fetchAll.mockRejectedValue(new DataError("DEVICE_REVOKED", 403));
    const error = await syncOnlineOnce(db, noTransport, options).catch(
      (e: unknown) => e,
    );
    expect((error as InstanceType<typeof TransportError>).kind).toBe("auth");
  });
});
