import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/auth/permissions";
import { PermissionError } from "@/commands/errors";
import type { LocalContext } from "@/commands/local/registry";
import { runCommand } from "@/commands/local/run";
import { StoreDB } from "@/db/local/db";
import { getDeviceId, getMeta } from "@/db/local/meta";
import { newId } from "@/lib/ids";
import { handlePull } from "@/server/sync/pull";
import { handlePush } from "@/server/sync/push";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import {
  pullAll,
  pushAll,
  recoverInterrupted,
  resetBackoff,
  syncOnce,
} from "../engine";
import { resolveConflict } from "../resolve";
import { type SyncTransport, TransportError } from "../transport";

let mongo: TestMongo;
let storeId: string;
let ownerId: string;
let cashierId: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  ownerId = await mongo.seedUser(storeId, "owner");
  cashierId = await mongo.seedUser(storeId, "cashier");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

interface Faults {
  /** Fail before the request reaches the server (offline). */
  offline: boolean;
  /** Server commits, but the response never arrives. */
  dropNextResponses: number;
  /** Probability (0-1) of either failure mode on each request. */
  flaky: number;
}

interface Device {
  db: StoreDB;
  ctx: LocalContext;
  faults: Faults;
  transport: SyncTransport;
  sync: () => ReturnType<typeof syncOnce>;
  options: { deviceId: string; appVersion: string };
}

async function newDevice(
  role: Role = "owner",
  actorUserId = ownerId,
): Promise<Device> {
  const db = new StoreDB(`dev-${randomUUID()}`);
  const deviceId = await getDeviceId(db);
  const faults: Faults = { offline: false, dropNextResponses: 0, flaky: 0 };
  const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  const transport: SyncTransport = {
    async push(request) {
      if (faults.offline || Math.random() < faults.flaky / 2)
        throw new TransportError("network");
      const response = wire(
        await handlePush(mongo, { storeId, deviceId }, wire(request)),
      );
      if (faults.dropNextResponses > 0 || Math.random() < faults.flaky / 2) {
        faults.dropNextResponses = Math.max(0, faults.dropNextResponses - 1);
        throw new TransportError("network"); // committed on the server, but we never hear back
      }
      return response;
    },
    async pull(cursor) {
      if (faults.offline || Math.random() < faults.flaky / 2)
        throw new TransportError("network");
      return wire(await handlePull(mongo.db, storeId, cursor));
    },
  };

  const options = { deviceId, appVersion: "1.0.0" };
  return {
    db,
    ctx: { storeId, actorUserId, role, deviceId },
    faults,
    transport,
    options,
    sync: () => syncOnce(db, transport, options),
  };
}

const addCategory = (d: Device, name: string, id = newId()) =>
  runCommand(d.db, d.ctx, "category.create", { id, name }).then(() => id);

const serverCount = (id: string) =>
  mongo.db.collection("categories").countDocuments({ _id: id as never });
const pending = (d: Device) =>
  d.db.outbox.where("status").anyOf("pending", "syncing").count();

describe("local commands", () => {
  it("apply instantly and queue the operation in the same transaction", async () => {
    const d = await newDevice();
    const id = await addCategory(d, "Groceries");
    expect(await d.db.categories.get(id)).toMatchObject({
      name: "Groceries",
      version: 1,
      storeId,
    });
    const [op] = await d.db.outbox.toArray();
    expect(op).toMatchObject({
      type: "category.create",
      entityId: id,
      status: "pending",
      collection: "categories",
    });
  });

  it("fills in baseVersion and bumps the local version on edits", async () => {
    const d = await newDevice();
    const id = await addCategory(d, "A");
    await runCommand(d.db, d.ctx, "category.update", {
      id,
      changes: { name: "B" },
    });
    await runCommand(d.db, d.ctx, "category.update", {
      id,
      changes: { nameBn: "বি" },
    });
    const ops = await d.db.outbox.orderBy("seq").toArray();
    expect(
      ops.map((o) => (o.payload as { baseVersion?: number }).baseVersion),
    ).toEqual([undefined, 1, 2]);
    expect(await d.db.categories.get(id)).toMatchObject({
      name: "B",
      nameBn: "বি",
      version: 3,
    });
  });

  it("refuses a cashier and leaves nothing behind", async () => {
    const d = await newDevice("cashier", cashierId);
    await expect(addCategory(d, "Nope")).rejects.toBeInstanceOf(
      PermissionError,
    );
    expect(await d.db.categories.count()).toBe(0);
    expect(await d.db.outbox.count()).toBe(0);
  });

  it("rolls back completely when the change itself fails", async () => {
    const d = await newDevice();
    await expect(
      runCommand(d.db, d.ctx, "category.update", {
        id: newId(),
        changes: { name: "x" },
      }),
    ).rejects.toThrow();
    expect(await d.db.outbox.count()).toBe(0);
  });
});

describe("sync: one device", () => {
  it("pushes an offline sale-of-work and marks it synced", async () => {
    const d = await newDevice();
    d.faults.offline = true;
    const id = await addCategory(d, "Made offline");
    await expect(d.sync()).rejects.toBeInstanceOf(TransportError);
    expect(await pending(d)).toBe(1);
    expect(await serverCount(id)).toBe(0);

    d.faults.offline = false;
    await resetBackoff(d.db);
    const outcome = await d.sync();
    expect(outcome.pushed).toBe(1);
    expect(await pending(d)).toBe(0);
    expect(await serverCount(id)).toBe(1);
    expect(await d.db.categories.get(id)).toMatchObject({
      version: 1,
      syncSeq: expect.any(Number),
    });
    expect(await getMeta(d.db, "cursor")).toBeGreaterThan(0);
  });

  it("does not hammer the server: failed operations wait out a backoff", async () => {
    const d = await newDevice();
    d.faults.offline = true;
    await addCategory(d, "Waiting");
    await expect(pushAll(d.db, d.transport, d.options)).rejects.toThrow();
    const [op] = await d.db.outbox.toArray();
    expect(op.attempts).toBe(1);
    expect(op.nextAttemptAt).toBeGreaterThan(Date.now());

    d.faults.offline = false;
    expect((await pushAll(d.db, d.transport, d.options)).sent).toBe(0); // still backing off
    await resetBackoff(d.db);
    expect((await pushAll(d.db, d.transport, d.options)).sent).toBe(1);
  });

  it("creates no duplicate when the response is lost after the server committed", async () => {
    const d = await newDevice();
    const id = await addCategory(d, "Lost ack");
    d.faults.dropNextResponses = 1;
    await expect(d.sync()).rejects.toThrow();
    expect(await serverCount(id)).toBe(1); // it did commit
    expect(await pending(d)).toBe(1); // but the device does not know

    await resetBackoff(d.db);
    await d.sync(); // re-sends the same operation id
    expect(await serverCount(id)).toBe(1);
    expect(await pending(d)).toBe(0);
  });

  it("survives a flapping connection with no duplicates and no losses", async () => {
    const d = await newDevice();
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) ids.push(await addCategory(d, `Item ${i}`));
    for (let i = 0; i < 12; i++)
      await runCommand(d.db, d.ctx, "category.update", {
        id: ids[i],
        changes: { description: `edited ${i}` },
      });

    d.faults.flaky = 0.6;
    for (let attempt = 0; attempt < 400 && (await pending(d)) > 0; attempt++) {
      await resetBackoff(d.db);
      await d.sync().catch(() => undefined);
    }
    d.faults.flaky = 0;
    await resetBackoff(d.db);
    await d.sync();

    expect(await pending(d)).toBe(0);
    for (const id of ids) expect(await serverCount(id)).toBe(1);
    const stored = await mongo.db
      .collection("categories")
      .findOne({ _id: ids[3] as never });
    expect(stored).toMatchObject({
      name: "Item 3",
      description: "edited 3",
      version: 2,
    });
    expect(await d.db.categories.get(ids[3])).toMatchObject({
      description: "edited 3",
      version: 2,
    });
  });

  it("re-sends operations that were mid-flight when the app was killed", async () => {
    const d = await newDevice();
    const id = await addCategory(d, "Interrupted");
    await d.db.outbox
      .where("status")
      .equals("pending")
      .modify({ status: "syncing" }); // crash after marking
    await recoverInterrupted(d.db);
    await d.sync();
    expect(await serverCount(id)).toBe(1);
    expect(await pending(d)).toBe(0);
  });

  it("drops a rejected create from the screen and flags the operation", async () => {
    // The device believes it is an owner; the server knows the actor is a cashier.
    const d = await newDevice("owner", cashierId);
    const id = await addCategory(d, "Forged permission");
    await d.sync();
    const [op] = await d.db.outbox.toArray();
    expect(op).toMatchObject({ status: "failed", lastError: "FORBIDDEN" });
    expect(await d.db.categories.get(id)).toBeUndefined();
    expect(await serverCount(id)).toBe(0);
  });
});

describe("sync: two devices", () => {
  it("shows one device's work on the other", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const id = await addCategory(a, "Shared");
    await a.sync();
    await b.sync();
    expect(await b.db.categories.get(id)).toMatchObject({
      name: "Shared",
      version: 1,
    });

    await runCommand(a.db, a.ctx, "category.delete", { id });
    await a.sync();
    await b.sync();
    expect((await b.db.categories.get(id))?.deletedAt).toBeTruthy();
  });

  it("converges when both devices edit different fields while offline", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const id = await addCategory(a, "Base");
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    b.faults.offline = true;
    await runCommand(a.db, a.ctx, "category.update", {
      id,
      changes: { nameBn: "ভিত্তি" },
    });
    await runCommand(b.db, b.ctx, "category.update", {
      id,
      changes: { description: "from B" },
    });
    a.faults.offline = false;
    b.faults.offline = false;

    await a.sync();
    await b.sync();
    await a.sync();

    const [docA, docB] = [
      await a.db.categories.get(id),
      await b.db.categories.get(id),
    ];
    expect(docA).toMatchObject({
      name: "Base",
      nameBn: "ভিত্তি",
      description: "from B",
    });
    expect(docB).toMatchObject({
      name: "Base",
      nameBn: "ভিত্তি",
      description: "from B",
    });
    expect(docA?.version).toBe(docB?.version);
  });

  it("keeps unsynced local edits when other devices' changes arrive first", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const id = await addCategory(a, "Original");
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    await runCommand(a.db, a.ctx, "category.update", {
      id,
      changes: { nameBn: "আমার" },
    }); // unsynced on A
    await runCommand(b.db, b.ctx, "category.update", {
      id,
      changes: { name: "Renamed by B" },
    });
    await b.sync();

    a.faults.offline = false;
    await pullAll(a.db, a.transport); // B's change lands while A still has its own pending
    expect(await a.db.categories.get(id)).toMatchObject({
      name: "Renamed by B",
      nameBn: "আমার",
      version: 3,
    });

    await a.sync();
    expect(await pending(a)).toBe(0);
    expect(
      await mongo.db.collection("categories").findOne({ _id: id as never }),
    ).toMatchObject({
      name: "Renamed by B",
      nameBn: "আমার",
    });
  });

  it("syncs settings with the latest write winning", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const key = `test.${randomUUID().slice(0, 6)}`;
    await runCommand(a.db, a.ctx, "setting.set", {
      key,
      value: { footer: "Thanks!" },
    });
    await a.sync();
    await b.sync();
    expect(await b.db.settings.get(key)).toMatchObject({
      value: { footer: "Thanks!" },
      version: 1,
    });
  });

  it("pulls a large backlog in pages", async () => {
    const a = await newDevice();
    for (let i = 0; i < 60; i++) await addCategory(a, `Bulk ${i}`);
    await a.sync();

    const fresh = await newDevice(); // a brand-new install
    const small: SyncTransport = {
      push: fresh.transport.push,
      pull: (c) =>
        handlePull(mongo.db, storeId, c, 25).then((r) =>
          JSON.parse(JSON.stringify(r)),
        ),
    };
    const { pages } = await pullAll(fresh.db, small);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(
      await fresh.db.categories.where("name").startsWith("Bulk ").count(),
    ).toBe(60);
  });
});

describe("conflict resolution", () => {
  async function conflicted() {
    const d = await newDevice();
    const id = await addCategory(d, "Mine");
    await d.sync();
    await runCommand(d.db, d.ctx, "category.update", {
      id,
      changes: { name: "My edit" },
    });
    const [op] = await d.db.outbox.where("status").equals("pending").toArray();
    const serverDoc = {
      id,
      name: "Their edit",
      version: 5,
      syncSeq: 1_000_000,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    };
    await d.db.outbox.update(op.seq as number, {
      status: "conflict",
      serverDoc: serverDoc as never,
    });
    return { d, id, op };
  }

  it("keep server: drops the operation and shows the server's value", async () => {
    const { d, id, op } = await conflicted();
    await resolveConflict(d.db, op.operationId, "server");
    expect(
      await d.db.outbox.where("operationId").equals(op.operationId).count(),
    ).toBe(0);
    expect(await d.db.categories.get(id)).toMatchObject({
      name: "Their edit",
      version: 5,
    });
  });

  it("keep mine: re-queues the operation on top of the server's version", async () => {
    const { d, id, op } = await conflicted();
    await resolveConflict(d.db, op.operationId, "mine");
    const requeued = await d.db.outbox
      .where("operationId")
      .equals(op.operationId)
      .first();
    expect(requeued).toMatchObject({
      status: "pending",
      payload: { baseVersion: 5 },
    });
    expect(await d.db.categories.get(id)).toMatchObject({
      name: "My edit",
      version: 6,
    });
  });
});
