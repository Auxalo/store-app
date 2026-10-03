import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import {
  APPLIED_OPS_RETENTION_SECONDS,
  ensureSyncIndexes,
} from "../sync/collections";

let mongo: TestMongo;

beforeAll(async () => {
  mongo = await startMongo();
}, 120_000);
afterAll(async () => {
  await mongo?.stop();
});

const lifetime = async (collection: string) =>
  (await mongo.db.collection(collection).indexes()).find(
    (i) => i.expireAfterSeconds !== undefined && i.key.appliedAt !== undefined,
  )?.expireAfterSeconds;

describe("expiring records", () => {
  it("applied-operation records expire after 45 days", async () => {
    expect(await lifetime("appliedOps")).toBe(APPLIED_OPS_RETENTION_SECONDS);
    expect(APPLIED_OPS_RETENTION_SECONDS).toBe(45 * 86_400);
  });

  it("an older database that kept them for 180 days is moved to the new lifetime, not refused", async () => {
    const db = mongo.db;
    await db.collection("appliedOps").dropIndex("appliedAt_1");
    await db
      .collection("appliedOps")
      .createIndex({ appliedAt: 1 }, { expireAfterSeconds: 180 * 86_400 });
    expect(await lifetime("appliedOps")).toBe(180 * 86_400);

    // A new process starting up sets it right (a fresh Db handle: nothing remembered).
    await ensureSyncIndexes(mongo.client.db(db.databaseName));
    expect(await lifetime("appliedOps")).toBe(APPLIED_OPS_RETENTION_SECONDS);
  });
});
