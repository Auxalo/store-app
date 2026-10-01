import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { pruneIfDue, pruneOutbox } from "@/sync/prune";
import { StoreDB } from "../db";
import type { OutboxOp } from "../types";

const name = () => `mig-${Math.random().toString(36).slice(2)}`;

describe("upgrading a device that has old data", () => {
  it("v1 → latest: keeps categories and queued work, gives queued work its entityIds, adds the new tables", async () => {
    const dbName = name();

    // A phone that last opened the app at version 1.
    const old = new Dexie(dbName);
    old.version(1).stores({
      categories: "id, name, updatedAt, deletedAt",
      settings: "id",
      outbox: "++seq, &operationId, entityId, status, [status+seq]",
      syncMeta: "key",
    });
    await old
      .table("categories")
      .put({ id: "c1", name: "Dairy", storeId: "s", version: 1 });
    await old
      .table("settings")
      .put({ id: "store.profile", key: "store.profile", value: { name: "X" } });
    await old.table("syncMeta").put({ key: "deviceId", value: "dev-1" });
    await old.table("outbox").add({
      operationId: "op-1",
      type: "category.create",
      collection: "categories",
      entityId: "c1",
      status: "pending",
      payload: {},
      attempts: 0,
      nextAttemptAt: 0,
    });
    old.close();

    // The updated app opens the same database.
    const db = new StoreDB(dbName);
    await db.open();

    expect(await db.categories.get("c1")).toMatchObject({ name: "Dairy" });
    expect((await db.settings.get("store.profile"))?.value).toEqual({
      name: "X",
    });
    expect((await db.syncMeta.get("deviceId"))?.value).toBe("dev-1");
    const queued = await db.outbox.get(1);
    expect(queued?.entityIds).toEqual(["c1"]);
    // Queued work can be found through the new index, so a pull will not make it disappear.
    expect(await db.outbox.where("entityIds").equals("c1").count()).toBe(1);

    // Every table of the current version exists and is usable.
    for (const table of db.tables.map((t) => t.name))
      expect(await db.table(table).count()).toBeGreaterThanOrEqual(0);
    for (const needed of [
      "products",
      "sales",
      "saleItems",
      "suppliers",
      "purchases",
      "expenses",
      "returns",
      "localUsers",
      "ledgerEntries",
    ])
      expect(db.tables.map((t) => t.name)).toContain(needed);
    db.close();
  });

  it("opening twice is harmless", async () => {
    const dbName = name();
    const first = new StoreDB(dbName);
    await first.open();
    await first.categories.put({
      id: "c",
      storeId: "s",
      name: "A",
      nameBn: "",
      description: "",
      isActive: true,
    } as never);
    first.close();
    const second = new StoreDB(dbName);
    await second.open();
    expect(await second.categories.count()).toBe(1);
    second.close();
  });
});

describe("clearing out old sent operations", () => {
  const DAY = 86_400_000;
  const op = (
    id: string,
    status: OutboxOp["status"],
    syncedAt?: number,
  ): Omit<OutboxOp, "seq"> => ({
    operationId: id,
    type: "category.create",
    collection: "categories",
    entityId: id,
    entityIds: [id],
    schemaVersion: 1,
    payload: {},
    actorUserId: "u",
    deviceId: "d",
    createdAt: "2026-01-01T00:00:00.000Z",
    status,
    attempts: 0,
    nextAttemptAt: 0,
    syncedAt,
  });

  it("removes only old, accepted operations; unsent work and recent history stay", async () => {
    const db = new StoreDB(name());
    const now = Date.now();
    await db.outbox.bulkAdd([
      op("old-synced", "synced", now - 30 * DAY),
      op("recent-synced", "synced", now - 1 * DAY),
      op("pending", "pending"),
      op("failed", "failed"),
      op("conflict", "conflict"),
    ]);
    expect(await pruneOutbox(db, now)).toBe(1);
    const left = (await db.outbox.toArray()).map((o) => o.operationId).sort();
    expect(left).toEqual(["conflict", "failed", "pending", "recent-synced"]);
    db.close();
  });

  it("runs at most once a day", async () => {
    const db = new StoreDB(name());
    const now = Date.now();
    await db.outbox.add(op("a", "synced", now - 30 * DAY));
    expect(await pruneIfDue(db, now)).toBe(1);
    await db.outbox.add(op("b", "synced", now - 30 * DAY));
    expect(await pruneIfDue(db, now + 1000)).toBe(0); // too soon
    expect(await pruneIfDue(db, now + 2 * DAY)).toBe(1);
    db.close();
  });
});
