import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { Role } from "@/auth/permissions";
import { ensureSyncIndexes } from "@/server/sync/collections";
import type { SyncDeps } from "@/server/sync/push";

export interface TestMongo extends SyncDeps {
  stop: () => Promise<void>;
  /** Creates a store; returns its id. */
  seedStore: (name?: string) => Promise<string>;
  /** Creates a user in the Better Auth `user` collection; returns the id used as `actorUserId`. */
  seedUser: (
    storeId: string,
    role: Role,
    extra?: Record<string, unknown>,
  ) => Promise<string>;
  /** Switches the store's audit log on (it is off by default). */
  enableAudit: (storeId: string) => Promise<void>;
}

/** A throwaway single-node replica set (transactions need one) with a fresh database. */
export async function startMongo(): Promise<TestMongo> {
  const rs = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const client = new MongoClient(rs.getUri(), { monitorCommands: true });
  await client.connect();
  const db = client.db(`test_${randomUUID().slice(0, 8)}`);
  await ensureSyncIndexes(db);

  return {
    client,
    db,
    stop: async () => {
      await client.close();
      await rs.stop();
    },
    seedStore: async (name = "Test Store") => {
      const _id = randomUUID();
      await db
        .collection<{ _id: string }>("stores")
        .insertOne({ _id, name, syncSeq: 0 } as never);
      return _id;
    },
    seedUser: async (storeId, role, extra = {}) => {
      const _id = new ObjectId();
      await db.collection("user").insertOne({
        _id,
        storeId,
        role,
        isActive: true,
        name: `${role} user`,
        ...extra,
      });
      return _id.toHexString();
    },
    enableAudit: async (storeId) => {
      await db.collection<{ _id: string }>("settings").replaceOne(
        { _id: `${storeId}:audit.enabled` },
        {
          storeId,
          key: "audit.enabled",
          value: true,
          version: 1,
          syncSeq: 0,
        } as never,
        { upsert: true },
      );
    },
  };
}
