import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OP_SCHEMA_VERSION } from "@/commands/definitions";
import type { OpEnvelope, PushResult } from "@/schemas/sync";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { handlePull } from "../sync/pull";
import { handlePush } from "../sync/push";

let mongo: TestMongo;
let storeId: string;
let owner: string;
let cashier: string;
const deviceA = randomUUID();
const deviceB = randomUUID();

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  owner = await mongo.seedUser(storeId, "owner");
  cashier = await mongo.seedUser(storeId, "cashier");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

let clock = Date.parse("2026-10-01T10:00:00.000Z");
const tick = () => {
  clock += 1000;
  return new Date(clock).toISOString();
};

function op(
  type: string,
  payload: unknown,
  o: Partial<OpEnvelope> = {},
): OpEnvelope {
  return {
    operationId: randomUUID(),
    type,
    schemaVersion: OP_SCHEMA_VERSION,
    payload,
    actorUserId: owner,
    deviceId: deviceA,
    createdAt: tick(),
    ...o,
  };
}

async function push(
  device: string,
  ...ops: OpEnvelope[]
): Promise<PushResult[]> {
  const response = await handlePush(
    mongo,
    { storeId, deviceId: device },
    { deviceId: device, appVersion: "1.0.0", ops },
  );
  return response.results;
}

const createCategory = (id: string, name: string, o?: Partial<OpEnvelope>) =>
  op(
    "category.create",
    { id, name, nameBn: "", description: "", isActive: true },
    o,
  );

describe("push: applying operations", () => {
  it("creates a record with version 1 and a sync sequence", async () => {
    const id = randomUUID();
    const [result] = await push(deviceA, createCategory(id, "Groceries"));
    expect(result.status).toBe("applied");
    const doc = result.docs?.[0]?.doc;
    expect(doc).toMatchObject({
      id,
      name: "Groceries",
      version: 1,
      storeId,
      deletedAt: null,
    });
    expect(doc?.syncSeq).toBeGreaterThan(0);
    expect(doc).not.toHaveProperty("fieldVersions");
  });

  it("applies a create and an edit of it in the same batch, in order", async () => {
    const id = randomUUID();
    const results = await push(
      deviceA,
      createCategory(id, "Drinks"),
      op("category.update", {
        id,
        baseVersion: 1,
        changes: { nameBn: "পানীয়" },
      }),
    );
    expect(results.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(results[1].docs?.[0]?.doc).toMatchObject({
      name: "Drinks",
      nameBn: "পানীয়",
      version: 2,
    });
  });

  it("is idempotent: retrying the same operation changes nothing", async () => {
    const id = randomUUID();
    const create = createCategory(id, "Once");
    const [first] = await push(deviceA, create);
    const before = await mongo.db
      .collection("stores")
      .findOne({ _id: storeId as never });
    const [second, third] = [
      ...(await push(deviceA, create)),
      ...(await push(deviceA, create)),
    ];
    const after = await mongo.db
      .collection("stores")
      .findOne({ _id: storeId as never });

    expect(first.status).toBe("applied");
    expect(second.status).toBe("duplicate");
    expect(third.status).toBe("duplicate");
    expect(second.docs?.[0]?.doc.id).toBe(id);
    expect(
      await mongo.db
        .collection("categories")
        .countDocuments({ _id: id as never }),
    ).toBe(1);
    expect(after?.syncSeq).toBe(before?.syncSeq); // no sequence numbers burned by retries
  });

  it("applies exactly once when the same operation arrives concurrently", async () => {
    const id = randomUUID();
    const create = createCategory(id, "Racing");
    const batches = await Promise.all(
      Array.from({ length: 6 }, () => push(deviceA, create)),
    );
    const statuses = batches.map((b) => b[0].status);
    expect(statuses.filter((s) => s === "applied")).toHaveLength(1);
    expect(statuses.every((s) => s === "applied" || s === "duplicate")).toBe(
      true,
    );
    expect(
      await mongo.db
        .collection("categories")
        .countDocuments({ _id: id as never }),
    ).toBe(1);
  });

  it("gives every concurrent write a unique, gap-free sequence number", async () => {
    const before = (
      await mongo.db.collection("stores").findOne({ _id: storeId as never })
    )?.syncSeq as number;
    const ids = Array.from({ length: 15 }, () => randomUUID());
    await Promise.all(
      ids.map((id, i) => push(deviceA, createCategory(id, `Parallel ${i}`))),
    );
    const docs = await mongo.db
      .collection("categories")
      .find({ _id: { $in: ids as never[] } })
      .toArray();
    const seqs = docs.map((d) => d.syncSeq as number).sort((a, b) => a - b);
    expect(seqs).toHaveLength(15);
    expect(seqs).toEqual(Array.from({ length: 15 }, (_, i) => before + 1 + i));
  });
});

describe("push: validation and permissions", () => {
  it("rejects unknown commands, bad payloads, future schema versions and device mismatch", async () => {
    const [unknown, invalid, future, mismatch] = await push(
      deviceA,
      op("nope.nothing", {}),
      op("category.create", { id: randomUUID(), name: "" }),
      createCategory(randomUUID(), "Future", {
        schemaVersion: OP_SCHEMA_VERSION + 1,
      }),
      createCategory(randomUUID(), "Other device", { deviceId: deviceB }),
    );
    expect(unknown).toMatchObject({
      status: "rejected",
      error: "UNKNOWN_COMMAND",
    });
    expect(invalid).toMatchObject({
      status: "rejected",
      error: "INVALID_PAYLOAD",
    });
    expect(future).toMatchObject({
      status: "rejected",
      error: "UNSUPPORTED_SCHEMA_VERSION",
    });
    expect(mismatch).toMatchObject({
      status: "rejected",
      error: "DEVICE_MISMATCH",
    });
  });

  it("enforces role permissions on the server, whatever the device claims", async () => {
    const [denied] = await push(
      deviceA,
      createCategory(randomUUID(), "Sneaky", { actorUserId: cashier }),
    );
    expect(denied).toMatchObject({ status: "rejected", error: "FORBIDDEN" });
  });

  it("rejects unknown, inactive and foreign-store actors", async () => {
    const inactive = await mongo.seedUser(storeId, "owner", {
      isActive: false,
    });
    const otherStore = await mongo.seedStore("Other");
    const stranger = await mongo.seedUser(otherStore, "owner");
    const results = await push(
      deviceA,
      createCategory(randomUUID(), "a", {
        actorUserId: "0123456789abcdef01234567",
      }),
      createCategory(randomUUID(), "b", { actorUserId: inactive }),
      createCategory(randomUUID(), "c", { actorUserId: stranger }),
      createCategory(randomUUID(), "d", { actorUserId: "not-an-object-id" }),
    );
    expect(results.map((r) => r.error)).toEqual(
      Array(4).fill("ACTOR_NOT_ALLOWED"),
    );
  });

  it("rejects editing something that does not exist", async () => {
    const [result] = await push(
      deviceA,
      op("category.update", {
        id: randomUUID(),
        baseVersion: 1,
        changes: { name: "x" },
      }),
    );
    expect(result).toMatchObject({ status: "rejected", error: "NOT_FOUND" });
  });

  it("does not let one store touch another store's record", async () => {
    const otherStore = await mongo.seedStore("Isolated");
    const otherOwner = await mongo.seedUser(otherStore, "owner");
    const id = randomUUID();
    await push(deviceA, createCategory(id, "Mine"));
    const response = await handlePush(
      mongo,
      { storeId: otherStore, deviceId: deviceB },
      {
        deviceId: deviceB,
        appVersion: "1.0.0",
        ops: [
          op(
            "category.update",
            { id, baseVersion: 1, changes: { name: "Hijacked" } },
            { actorUserId: otherOwner, deviceId: deviceB },
          ),
        ],
      },
    );
    expect(response.results[0]).toMatchObject({
      status: "rejected",
      error: "NOT_FOUND",
    });
    expect(
      (await mongo.db.collection("categories").findOne({ _id: id as never }))
        ?.name,
    ).toBe("Mine");
  });
});

describe("push: concurrent edits from two devices", () => {
  it("merges edits to different fields automatically", async () => {
    const id = randomUUID();
    await push(deviceA, createCategory(id, "Base"));
    // Both devices edited version 1 offline.
    const [a] = await push(
      deviceA,
      op("category.update", { id, baseVersion: 1, changes: { nameBn: "বাংলা" } }),
    );
    const [b] = await push(
      deviceB,
      op(
        "category.update",
        { id, baseVersion: 1, changes: { description: "Notes" } },
        { deviceId: deviceB },
      ),
    );
    expect([a.status, b.status]).toEqual(["applied", "applied"]);
    expect(b.docs?.[0]?.doc).toMatchObject({
      name: "Base",
      nameBn: "বাংলা",
      description: "Notes",
      version: 3,
    });
  });

  it("resolves a clash on the same ordinary field by the most recent action", async () => {
    const id = randomUUID();
    await push(deviceA, createCategory(id, "Base"));
    const earlier = op("category.update", {
      id,
      baseVersion: 1,
      changes: { name: "Earlier" },
    });
    const later = op(
      "category.update",
      { id, baseVersion: 1, changes: { name: "Later" } },
      { deviceId: deviceB },
    );

    // The later action reaches the server first; the older one must not overwrite it.
    await push(deviceB, later);
    const [late] = await push(deviceA, earlier);
    expect(late.status).toBe("applied");
    expect(late.docs?.[0]?.doc.name).toBe("Later");
  });

  it("deletes softly, keeps a tombstone, and rejects later edits", async () => {
    const id = randomUUID();
    await push(deviceA, createCategory(id, "Doomed"));
    const [deleted] = await push(
      deviceA,
      op("category.delete", { id, baseVersion: 1 }),
    );
    const [again] = await push(
      deviceA,
      op("category.delete", { id, baseVersion: 2 }),
    );
    const [edit] = await push(
      deviceB,
      op(
        "category.update",
        { id, baseVersion: 1, changes: { name: "Zombie" } },
        { deviceId: deviceB },
      ),
    );

    expect(deleted.docs?.[0]?.doc.deletedAt).toBeTruthy();
    expect(again.status).toBe("applied");
    expect(edit).toMatchObject({ status: "rejected", error: "DELETED" });
    expect(
      await mongo.db
        .collection("categories")
        .countDocuments({ _id: id as never }),
    ).toBe(1);
  });
});

describe("settings", () => {
  it("keeps the most recent value per key regardless of arrival order", async () => {
    const key = `receipt.footer.${randomUUID().slice(0, 4)}`;
    const newer = op("setting.set", { key, value: "newer", baseVersion: 0 });
    const older = op(
      "setting.set",
      { key, value: "older", baseVersion: 0 },
      { createdAt: new Date(Date.parse(newer.createdAt) - 5000).toISOString() },
    );
    await push(deviceA, newer);
    const [result] = await push(deviceA, older);
    expect(result.docs?.[0]?.doc).toMatchObject({ id: key, value: "newer" });
  });
});

describe("pull", () => {
  it("pages through changes in order without gaps or repeats, then goes quiet", async () => {
    const pullStore = await mongo.seedStore("Pull store");
    const pullOwner = await mongo.seedUser(pullStore, "owner");
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const ops = [
      ...ids.map((id, i) =>
        createCategory(id, `P${i}`, { actorUserId: pullOwner }),
      ),
      op(
        "setting.set",
        { key: "a", value: 1, baseVersion: 0 },
        { actorUserId: pullOwner },
      ),
      op(
        "setting.set",
        { key: "b", value: 2, baseVersion: 0 },
        { actorUserId: pullOwner },
      ),
    ];
    await handlePush(
      mongo,
      { storeId: pullStore, deviceId: deviceA },
      { deviceId: deviceA, appVersion: "1.0.0", ops },
    );

    const seen: number[] = [];
    let cursor = 0;
    let pages = 0;
    for (;;) {
      const page = await handlePull(mongo.db, pullStore, cursor, 3);
      pages++;
      for (const doc of [...page.changes.categories, ...page.changes.settings])
        seen.push(doc.syncSeq);
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(cursor).toBe(7);

    const quiet = await handlePull(mongo.db, pullStore, cursor);
    expect(quiet.hasMore).toBe(false);
    expect(quiet.changes.categories).toHaveLength(0);
  });

  it("only returns the caller's store, includes tombstones, and uses plain keys for settings", async () => {
    const s = await mongo.seedStore("Scoped");
    const u = await mongo.seedUser(s, "owner");
    const id = randomUUID();
    await handlePush(
      mongo,
      { storeId: s, deviceId: deviceA },
      {
        deviceId: deviceA,
        appVersion: "1.0.0",
        ops: [
          createCategory(id, "Gone", { actorUserId: u }),
          op("category.delete", { id, baseVersion: 1 }, { actorUserId: u }),
          op(
            "setting.set",
            { key: "store.name", value: "Shop", baseVersion: 0 },
            { actorUserId: u },
          ),
        ],
      },
    );
    const page = await handlePull(mongo.db, s, 0);
    expect(page.changes.categories).toHaveLength(1);
    expect(page.changes.categories[0]).toMatchObject({ id, version: 2 });
    expect(page.changes.categories[0].deletedAt).toBeTruthy();
    expect(page.changes.settings[0]).toMatchObject({
      id: "store.name",
      value: "Shop",
    });
  });
});
