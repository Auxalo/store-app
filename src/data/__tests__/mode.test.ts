import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { StoreDB } from "@/db/local/db";
import { getMeta, setMeta } from "@/db/local/meta";
import { newId } from "@/lib/ids";
import {
  DEFAULT_FOR_NEW_DEVICES,
  MODE_STORAGE_KEY,
  readStoredMode,
  resolveDataMode,
  setDataMode,
} from "../mode";

const fresh = () => new StoreDB(`mode-${newId()}`);

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
  };
});

describe("data mode", () => {
  it("a brand-new device starts with the default for new devices", async () => {
    expect(await resolveDataMode(fresh())).toBe(DEFAULT_FOR_NEW_DEVICES);
  });

  it("a choice the browser remembers is adopted by a device that has none, but never overrides a saved one", async () => {
    memory.set(MODE_STORAGE_KEY, "online");
    expect(await resolveDataMode(fresh())).toBe("online");
    const saved = fresh();
    await setMeta(saved, "dataMode", "offline");
    memory.set(MODE_STORAGE_KEY, "online"); // disagrees with what the device saved
    expect(await resolveDataMode(saved)).toBe("offline");
    expect(readStoredMode()).toBe("offline"); // and the mirror is corrected
  });

  it("a device that has already downloaded the shop keeps working offline", async () => {
    const db = fresh();
    await setMeta(db, "cursor", 120);
    expect(await resolveDataMode(db)).toBe("offline");
  });

  it("a device with changes waiting to be sent keeps working offline, so nothing is stranded", async () => {
    const db = fresh();
    await db.outbox.add({
      operationId: newId(),
      type: "category.create",
      collection: "categories",
      entityId: "c",
      entityIds: ["c"],
      schemaVersion: 1,
      payload: {},
      actorUserId: "u",
      deviceId: "d",
      createdAt: new Date().toISOString(),
      status: "pending",
      attempts: 0,
      nextAttemptAt: 0,
    });
    expect(await resolveDataMode(db)).toBe("offline");
  });

  it("remembers the choice, and an explicit choice always wins over the rule", async () => {
    const db = fresh();
    await setMeta(db, "cursor", 5); // would resolve to offline
    await setDataMode(db, "online");
    expect(await resolveDataMode(db)).toBe("online");
    expect(await getMeta(db, "dataMode")).toBe("online");
    await setDataMode(db, "offline");
    expect(await resolveDataMode(db)).toBe("offline");
  });

  it("mirrors the mode to localStorage for the first paint, and ignores junk there", async () => {
    expect(readStoredMode()).toBeNull();
    await resolveDataMode(fresh());
    expect(readStoredMode()).toBe(DEFAULT_FOR_NEW_DEVICES);
    memory.set(MODE_STORAGE_KEY, "sideways");
    expect(readStoredMode()).toBeNull();
  });

  it("works when localStorage is not available at all", async () => {
    (globalThis as { localStorage?: unknown }).localStorage = undefined;
    expect(readStoredMode()).toBeNull();
    expect(await resolveDataMode(fresh())).toBe(DEFAULT_FOR_NEW_DEVICES);
  });
});
