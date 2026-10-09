/**
 * QA audit, part 2: who may do what (findings H2, H3, H4, H5, M1).
 *
 * Each test states what SHOULD happen. A test written `knownBug(...)` pins a problem that is still
 * open and starts failing the day it is fixed. See docs/QA-REPORT.md.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deviceSigningKey, signOp } from "@/auth/op-proof";
import { hashPin } from "@/auth/pin";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { unlockActor } from "../actor";
import { clearStoreCaches } from "../cache";
import {
  checkDevice,
  DEVICE_COOKIE,
  deviceCookieValue,
  registerDevice,
} from "../devices";
import { listStaff, setStaffPin } from "../staff";
import { updateStaffMember } from "../staff-admin";
import { handlePush } from "../sync/push";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
let storeId: string;
let owner: string;
let cashier: string;
let ownerKey: string;

const SECRET = "x".repeat(40);

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore("QA Security Shop");
  const ownerPin = await hashPin("9999");
  const cashierPin = await hashPin("1234");
  owner = await mongo.seedUser(storeId, "owner", {
    name: "Owner",
    pinSalt: ownerPin.salt,
    pinHash: ownerPin.hash,
    pinProofKey: ownerPin.proof,
  });
  cashier = await mongo.seedUser(storeId, "cashier", {
    name: "Cashier",
    pinSalt: cashierPin.salt,
    pinHash: cashierPin.hash,
    pinProofKey: cashierPin.proof,
  });
  ownerKey = ownerPin.proof as string;
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const col = (name: string) => mongo.db.collection(name);

async function newDevice(by: string) {
  const deviceId = randomUUID();
  const registration = await registerDevice(mongo.db, {
    storeId,
    userId: by,
    deviceId,
    name: "Phone",
    existing: { ok: false, reason: "missing" },
  });
  return {
    deviceId,
    cookie: `${DEVICE_COOKIE}=${deviceCookieValue(deviceId, registration.token as string)}`,
  };
}

describe("QA H2: whose name an offline operation carries", () => {
  // The server cannot see who is at the counter when a device syncs later. An owner's or manager's
  // action must therefore be signed with a key only that person's PIN makes.
  async function deviceOf(by: string) {
    const made = await newDevice(by);
    const check = await checkDevice(mongo.db, made.cookie);
    if (!check.ok) throw new Error("device");
    return { ...made, auth: check.device };
  }

  const settingOp = (
    deviceId: string,
    actor: string,
    key: string | null,
    over: Partial<{ value: string; createdAt: string }> = {},
  ) => {
    const op = {
      operationId: randomUUID(),
      type: "setting.set",
      schemaVersion: 1,
      payload: {
        key: "receipt.footer",
        value: over.value ?? "thanks",
        baseVersion: 0,
      },
      actorUserId: actor,
      deviceId,
      createdAt: over.createdAt ?? new Date().toISOString(),
    };
    return key ? { ...op, proof: signOp(key, op) } : op;
  };
  // What a manager may do (settings are the owner's alone).
  const categoryOp = (deviceId: string, actor: string, key: string | null) => {
    const op = {
      operationId: randomUUID(),
      type: "category.create",
      schemaVersion: 1,
      payload: { id: randomUUID(), name: "Drinks" },
      actorUserId: actor,
      deviceId,
      createdAt: new Date().toISOString(),
    };
    return key ? { ...op, proof: signOp(key, op) } : op;
  };
  const push = (
    device: Awaited<ReturnType<typeof deviceOf>>,
    ...ops: unknown[]
  ) =>
    handlePush(mongo, device.auth, {
      deviceId: device.deviceId,
      appVersion: "1.0.0",
      ops,
    });

  it("a device used by a cashier cannot push an operation in the owner's name", async () => {
    const device = await deviceOf(cashier);
    const response = await push(
      device,
      settingOp(device.deviceId, owner, null),
    );
    expect(response.results[0]).toMatchObject({
      status: "rejected",
      error: "PROOF_REQUIRED",
    });
  });

  it("the owner signed in with the password signs with the key the server gave this device", async () => {
    const before = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = SECRET;
    try {
      const device = await deviceOf(owner);
      const key = deviceSigningKey(SECRET, owner, device.deviceId);
      const ok = await push(device, settingOp(device.deviceId, owner, key));
      expect(ok.results[0].status).toBe("applied");

      // The key is for this person on this device only: another device's key, or the owner's key
      // used to sign as someone else, is refused.
      const other = await deviceOf(cashier);
      const wrongDevice = await push(
        other,
        settingOp(other.deviceId, owner, key),
      );
      expect(wrongDevice.results[0].error).toBe("PROOF_REQUIRED");
    } finally {
      process.env.BETTER_AUTH_SECRET = before;
    }
  });

  it("a cashier signing with their own key cannot pass as the owner", async () => {
    const device = await deviceOf(cashier);
    const cashierKey = (await hashPin("1234")).proof as string;
    const response = await push(
      device,
      settingOp(device.deviceId, owner, cashierKey),
    );
    expect(response.results[0]).toMatchObject({ error: "PROOF_REQUIRED" });
  });

  it("the owner's own signed operation is applied, even from a device a cashier set up", async () => {
    const device = await deviceOf(cashier);
    const response = await push(
      device,
      settingOp(device.deviceId, owner, ownerKey),
    );
    expect(response.results[0].status).toBe("applied");
  });

  it("a signed operation cannot be changed or re-dated afterwards", async () => {
    const device = await deviceOf(cashier);
    const op = settingOp(device.deviceId, owner, ownerKey);
    const changed = { ...op, payload: { ...op.payload, value: "hacked" } };
    const redated = {
      ...settingOp(device.deviceId, owner, ownerKey),
      createdAt: new Date(Date.now() - 1000).toISOString(),
    };
    const response = await push(device, changed, redated);
    expect(response.results.map((r) => r.error)).toEqual([
      "PROOF_REQUIRED",
      "PROOF_REQUIRED",
    ]);
  });

  it("settling a conflict (the app changes baseVersion) does not break the signature", async () => {
    const device = await deviceOf(cashier);
    const op = settingOp(device.deviceId, owner, ownerKey);
    const settled = { ...op, payload: { ...op.payload, baseVersion: 7 } };
    const response = await push(device, settled);
    expect(response.results[0].error).not.toBe("PROOF_REQUIRED");
  });

  it("a cashier's own operation needs no signature (a cashier may do nothing but sell)", async () => {
    const device = await deviceOf(cashier);
    const response = await push(device, {
      operationId: randomUUID(),
      type: "category.create",
      schemaVersion: 1,
      payload: { id: randomUUID(), name: "x" },
      actorUserId: cashier,
      deviceId: device.deviceId,
      createdAt: new Date().toISOString(),
    });
    // Refused for the role's permissions, not for a missing proof.
    expect(response.results[0].error).toBe("FORBIDDEN");
  });

  it("after a PIN change, work signed with the previous key is still accepted, the one before is not", async () => {
    const manager = await mongo.seedUser(storeId, "manager", {
      name: "Manager",
    });
    const first = await hashPin("2468");
    await setStaffPin(mongo.db, storeId, manager, first);
    const device = await deviceOf(manager);
    const queued = categoryOp(device.deviceId, manager, first.proof as string);
    await setStaffPin(mongo.db, storeId, manager, await hashPin("1357"));
    clearStoreCaches();
    expect((await push(device, queued)).results[0].status).toBe("applied");

    await setStaffPin(mongo.db, storeId, manager, await hashPin("9753"));
    clearStoreCaches();
    const again = await push(
      device,
      categoryOp(device.deviceId, manager, first.proof as string),
    );
    expect(again.results[0].error).toBe("PROOF_REQUIRED");
  });

  it("a person with no PIN is accepted only from a device they set up or entered their PIN on", async () => {
    const lonely = await mongo.seedUser(storeId, "manager", {
      name: "No PIN",
    });
    const elsewhere = await deviceOf(cashier);
    expect(
      (await push(elsewhere, categoryOp(elsewhere.deviceId, lonely, null)))
        .results[0].error,
    ).toBe("PROOF_REQUIRED");
    const own = await deviceOf(lonely);
    expect(
      (await push(own, categoryOp(own.deviceId, lonely, null))).results[0]
        .status,
    ).toBe("applied");
  });
});

async function deviceFor(by: string) {
  const made = await newDevice(by);
  const check = await checkDevice(mongo.db, made.cookie);
  if (!check.ok) throw new Error("device");
  return { ...made, info: check.device };
}

describe("QA H3: who can read people's PIN hashes", () => {
  it("a device that has not seen the owner sign in does not receive the owner's PIN hash", async () => {
    const device = await deviceFor(cashier);
    const staff = await listStaff(mongo.db, storeId, { device: device.info });
    const theOwner = staff.find((s) => s.id === owner);
    expect(theOwner?.pinHash).toBeUndefined();
    expect(theOwner?.hasPin).toBe(true);
    // The salt is not secret, and a cashier's hash goes to every device.
    expect(theOwner?.pinSalt).toBeDefined();
    expect(staff.find((s) => s.id === cashier)?.pinHash).toBeDefined();
  });

  it("without a viewer nobody's hash is sent", async () => {
    const staff = await listStaff(mongo.db, storeId);
    expect(staff.every((s) => s.pinHash === undefined)).toBe(true);
  });

  it("the device the owner set up, and one where they entered their PIN online, get the owner's hash", async () => {
    const setUp = await deviceFor(owner);
    expect(
      (await listStaff(mongo.db, storeId, { device: setUp.info })).find(
        (s) => s.id === owner,
      )?.pinHash,
    ).toBeDefined();

    const phone = await deviceFor(cashier);
    const unlocked = await unlockActor(mongo.db, {
      storeId,
      deviceId: phone.deviceId,
      userId: owner,
      pin: "9999",
      secret: SECRET,
    });
    expect(unlocked.ok).toBe(true);
    const after = await checkDevice(mongo.db, phone.cookie);
    if (!after.ok) throw new Error("device");
    expect(
      (await listStaff(mongo.db, storeId, { device: after.device })).find(
        (s) => s.id === owner,
      )?.pinHash,
    ).toBeDefined();
  });

  it("a wrong PIN does not give a device the owner's hash", async () => {
    const phone = await deviceFor(cashier);
    const result = await unlockActor(mongo.db, {
      storeId,
      deviceId: phone.deviceId,
      userId: owner,
      pin: "0000",
      secret: SECRET,
    });
    expect(result.ok).toBe(false);
    const after = await checkDevice(mongo.db, phone.cookie);
    if (!after.ok) throw new Error("device");
    expect(
      (await listStaff(mongo.db, storeId, { device: after.device })).find(
        (s) => s.id === owner,
      )?.pinHash,
    ).toBeUndefined();
  });

  it("a signed-in person gets their own hash, not another owner's or manager's", async () => {
    const staff = await listStaff(mongo.db, storeId, { userId: cashier });
    expect(staff.find((s) => s.id === owner)?.pinHash).toBeUndefined();
    expect(staff.find((s) => s.id === cashier)?.pinHash).toBeDefined();
  });

  it("the signing key is never in the list", async () => {
    const staff = await listStaff(mongo.db, storeId, { userId: owner });
    expect(JSON.stringify(staff)).not.toContain(ownerKey);
  });
});

describe("QA H4: a device outlives the person who registered it", () => {
  it("a device stops working when the person who registered it is deactivated", async () => {
    const lena = await mongo.seedUser(storeId, "cashier", {
      name: "Lena",
      username: "lena",
    });
    const device = await newDevice(lena);
    expect((await checkDevice(mongo.db, device.cookie)).ok).toBe(true);

    const result = await updateStaffMember(mongo.db, storeId, lena, {
      isActive: false,
    });
    expect(result.ok).toBe(true);
    clearStoreCaches();
    expect((await checkDevice(mongo.db, device.cookie)).ok).toBe(false);
  });

  it("a device registered by someone else keeps working", async () => {
    const lena = await mongo.seedUser(storeId, "cashier", {
      name: "Lena 2",
      username: "lena2",
    });
    const device = await newDevice(owner);
    await updateStaffMember(mongo.db, storeId, lena, { isActive: false });
    clearStoreCaches();
    expect((await checkDevice(mongo.db, device.cookie)).ok).toBe(true);
  });
});

describe("QA H5: guessing a PIN many times at once", () => {
  it("only the free tries are checked when 30 guesses arrive together", async () => {
    const device = await newDevice(owner);
    const attempts = await Promise.all(
      Array.from({ length: 30 }, () =>
        unlockActor(mongo.db, {
          storeId,
          deviceId: device.deviceId,
          userId: cashier,
          pin: "0000",
          secret: SECRET,
        }),
      ),
    );
    const checked = attempts.filter(
      (a) => !a.ok && a.reason === "WRONG_PIN",
    ).length;
    // The rules allow 4 free mistakes, then a wait: the rest must be told to wait, not checked.
    expect(checked).toBeLessThanOrEqual(5);
  }, 120_000);

  it("a wrong PIN is counted", async () => {
    const device = await newDevice(owner);
    const result = await unlockActor(mongo.db, {
      storeId,
      deviceId: device.deviceId,
      userId: cashier,
      pin: "1111",
      secret: SECRET,
    });
    expect(result).toMatchObject({ ok: false, reason: "WRONG_PIN" });
    expect(
      (
        await col("pinAttempts").findOne({
          _id: `${device.deviceId}:${cashier}` as never,
        })
      )?.failures,
    ).toBe(1);
  });
});

describe("QA M1: recovering after too many wrong PINs", () => {
  it("setting a new PIN lets the person unlock again", async () => {
    const device = await newDevice(owner);
    const key = `${device.deviceId}:${cashier}`;
    await col("pinAttempts").insertOne({
      _id: key as never,
      failures: 15,
      lastFailedAt: Date.now(),
    } as never);
    expect(
      await unlockActor(mongo.db, {
        storeId,
        deviceId: device.deviceId,
        userId: cashier,
        pin: "1234",
        secret: SECRET,
      }),
    ).toMatchObject({ ok: false, reason: "NEEDS_PASSWORD" });

    const fresh = await hashPin("4321");
    await setStaffPin(mongo.db, storeId, cashier, fresh);

    const result = await unlockActor(mongo.db, {
      storeId,
      deviceId: device.deviceId,
      userId: cashier,
      pin: "4321",
      secret: SECRET,
    });
    expect(result.ok).toBe(true);
    // Put the original PIN back for any later test.
    await setStaffPin(mongo.db, storeId, cashier, await hashPin("1234"));
  });
});
