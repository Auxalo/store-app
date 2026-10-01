import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import type { Role } from "@/auth/permissions";
import type { LocalContext } from "@/commands/local/registry";
import { StoreDB } from "@/db/local/db";
import { getDeviceId } from "@/db/local/meta";
import { handlePull } from "@/server/sync/pull";
import { handlePush } from "@/server/sync/push";
import { type EngineOptions, syncOnce } from "@/sync/engine";
import { type SyncTransport, TransportError } from "@/sync/transport";
import type { TestMongo } from "./mongo";

export interface Faults {
  /** Fail before the request reaches the server (offline). */
  offline: boolean;
  /** Server commits, but the response never arrives. */
  dropNextResponses: number;
  /** Probability (0-1) of either failure mode on each request. */
  flaky: number;
}

export interface Device {
  db: StoreDB;
  ctx: LocalContext;
  faults: Faults;
  transport: SyncTransport;
  options: EngineOptions;
  sync: () => ReturnType<typeof syncOnce>;
}

/**
 * A simulated phone/PC: its own on-device database (fake IndexedDB) talking to the real server
 * logic and a real MongoDB replica set, with switchable network faults in between.
 */
export async function createDevice(
  mongo: TestMongo,
  storeId: string,
  role: Role,
  actorUserId: string,
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
