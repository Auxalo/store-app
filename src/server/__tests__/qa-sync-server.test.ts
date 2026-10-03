/**
 * QA audit, part 3: the server side of sync and restore (findings S6, S8, S10, M8).
 * See docs/QA-REPORT.md.
 */
import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { clearStoreCaches } from "../cache";
import {
  checkDevice,
  DEVICE_COOKIE,
  deviceCookieValue,
  registerDevice,
  revokeDevice,
} from "../devices";
import { runOnlineCommand } from "../online-commands";
import { exportShop, restoreShop } from "../shop-export";
import { updateStaff } from "../staff";
import { handlePull } from "../sync/pull";
import { handlePush } from "../sync/push";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
let storeId: string;
let owner: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore("QA Sync Server Shop");
  owner = await mongo.seedUser(storeId, "owner", { username: "qa-owner" });
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const col = (name: string) => mongo.db.collection(name);

const op = (
  deviceId: string,
  actorUserId: string,
  type: string,
  payload: unknown,
  createdAt = new Date().toISOString(),
) => ({
  operationId: randomUUID(),
  type,
  schemaVersion: 1,
  payload,
  actorUserId,
  deviceId,
  createdAt,
});

const push = (deviceId: string, ops: ReturnType<typeof op>[]) =>
  handlePush(
    mongo,
    { storeId, deviceId },
    { deviceId, appVersion: "1.0.0", ops },
  );

describe("QA S6: offline work of someone who was deactivated afterwards", () => {
  const newCashier = () =>
    mongo.seedUser(storeId, "cashier", {
      username: `c${randomUUID().slice(0, 6)}`,
    });

  it("work done before the person was deactivated is still accepted when the device syncs", async () => {
    const cashier = await newCashier();
    const deviceId = randomUUID();
    const madeAt = new Date(Date.now() - 3_600_000).toISOString(); // an hour ago, offline
    await updateStaff(mongo.db, storeId, cashier, { isActive: false });
    clearStoreCaches();
    const result = await push(deviceId, [
      op(
        deviceId,
        cashier,
        "customer.create",
        { id: randomUUID(), name: "Walk-in" },
        madeAt,
      ),
    ]);
    expect(result.results[0].status).toBe("applied");
  });

  it("work made after the person was deactivated is refused", async () => {
    const cashier = await newCashier();
    const deviceId = randomUUID();
    await updateStaff(mongo.db, storeId, cashier, { isActive: false });
    clearStoreCaches();
    const later = new Date(Date.now() + 60_000).toISOString();
    const result = await push(deviceId, [
      op(
        deviceId,
        cashier,
        "customer.create",
        { id: randomUUID(), name: "Late" },
        later,
      ),
    ]);
    expect(result.results[0]).toMatchObject({
      status: "rejected",
      error: "ACTOR_NOT_ALLOWED",
    });
  });

  it("a person who is not in this shop is refused", async () => {
    const deviceId = randomUUID();
    const result = await push(deviceId, [
      op(deviceId, new ObjectId().toHexString(), "customer.create", {
        id: randomUUID(),
        name: "Nobody",
      }),
    ]);
    expect(result.results[0]).toMatchObject({ status: "rejected" });
  });
});

describe("QA S8: a device with a wrong clock", () => {
  it("an operation dated a day ahead does not move the shop's records into the future", async () => {
    const deviceId = randomUUID();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const id = randomUUID();
    const result = await push(deviceId, [
      op(deviceId, owner, "category.create", { id, name: "Future" }, tomorrow),
    ]);
    expect(result.results[0].status).toBe("applied");
    const doc = await col("categories").findOne({ _id: id as never });
    // A little slack for honest clock differences, never a day.
    expect(new Date(doc?.updatedAt as string).getTime()).toBeLessThan(
      Date.now() + 15 * 60_000,
    );
  });
});

describe("QA S10 and M8: restoring a shop from a backup", () => {
  async function shopWithBackup() {
    const shop = await mongo.seedStore(`Restore ${randomUUID().slice(0, 4)}`);
    const boss = await mongo.seedUser(shop, "owner", {
      username: `b${randomUUID().slice(0, 6)}`,
    });
    const run = (type: string, input: unknown) =>
      runOnlineCommand(
        mongo,
        { id: boss, role: "owner", storeId: shop, deviceId: "d" },
        { operationId: randomUUID(), type, input },
      );
    await run("product.create", {
      id: randomUUID(),
      name: "Before the backup",
      purchasePrice: 100,
      sellingPrice: 200,
      openingStock: 1000,
      openingMovementId: randomUUID(),
    });
    const lines: string[] = [];
    await exportShop(mongo.db, shop, (l) => {
      lines.push(l);
    });
    return { shop, boss, run, lines };
  }
  async function* iter(lines: string[]) {
    for (const line of lines) yield line;
  }

  it("a device that was up to date before the restore receives the restored records", async () => {
    const { shop, run, lines } = await shopWithBackup();
    await run("product.create", {
      id: randomUUID(),
      name: "After the backup",
      purchasePrice: 100,
      sellingPrice: 200,
      openingStock: 1000,
      openingMovementId: randomUUID(),
    });
    const store = await col("stores").findOne({ _id: shop as never });
    const cursor = Number(store?.syncSeq); // a phone that has everything up to here

    await restoreShop(mongo.db, () => iter(lines), { replace: true });

    const page = await handlePull(mongo.db, shop, cursor);
    const names = (page.changes.products ?? []).map((p) => String(p.name));
    expect(names).toContain("Before the backup");
  });

  it("the shop's change counter never goes back", async () => {
    const { shop, run, lines } = await shopWithBackup();
    await run("category.create", { id: randomUUID(), name: "Extra" });
    const before = Number(
      (await col("stores").findOne({ _id: shop as never }))?.syncSeq,
    );
    await restoreShop(mongo.db, () => iter(lines), { replace: true });
    const after = Number(
      (await col("stores").findOne({ _id: shop as never }))?.syncSeq,
    );
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it("a device that was revoked stays revoked after a restore of an older backup", async () => {
    const { shop, boss } = await shopWithBackup();
    const deviceId = randomUUID();
    const registration = await registerDevice(mongo.db, {
      storeId: shop,
      userId: boss,
      deviceId,
      name: "Lost phone",
      existing: { ok: false, reason: "missing" },
    });
    const cookie = `${DEVICE_COOKIE}=${deviceCookieValue(deviceId, registration.token as string)}`;
    // The backup is taken while the phone is still trusted; then it is lost and revoked.
    const backup: string[] = [];
    await exportShop(mongo.db, shop, (l) => {
      backup.push(l);
    });
    await revokeDevice(mongo.db, shop, deviceId);
    clearStoreCaches();
    expect((await checkDevice(mongo.db, cookie)).ok).toBe(false);

    await restoreShop(mongo.db, () => iter(backup), { replace: true });
    clearStoreCaches();
    expect((await checkDevice(mongo.db, cookie)).ok).toBe(false);
  });

  it("a person who was deactivated stays deactivated after a restore of an older backup", async () => {
    const { shop } = await shopWithBackup();
    const worker = await mongo.seedUser(shop, "cashier", {
      username: `w${randomUUID().slice(0, 6)}`,
    });
    const backup: string[] = [];
    await exportShop(mongo.db, shop, (l) => {
      backup.push(l);
    });
    await updateStaff(mongo.db, shop, worker, { isActive: false });
    await restoreShop(mongo.db, () => iter(backup), { replace: true });
    const user = await col("user").findOne({ _id: new ObjectId(worker) });
    expect(user?.isActive).toBe(false);
  });
});
