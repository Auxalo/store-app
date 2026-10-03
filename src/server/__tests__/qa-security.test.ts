/**
 * QA audit, part 2: who may do what (findings H2, H3, H4, H5, M1).
 *
 * Each test states what SHOULD happen. A test written `knownBug(...)` pins a problem that is still
 * open and starts failing the day it is fixed. See docs/QA-REPORT.md.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPin } from "@/auth/pin";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { knownBug } from "../../../tests/helpers/qa";
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
  });
  cashier = await mongo.seedUser(storeId, "cashier", {
    name: "Cashier",
    pinSalt: cashierPin.salt,
    pinHash: cashierPin.hash,
  });
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
  // The server cannot tell who is at the counter when a device syncs later: it takes the person
  // named in the operation. A cashier's device can therefore name the owner.
  knownBug(
    "a device used by a cashier cannot push an operation in the owner's name",
    async () => {
      const device = await newDevice(cashier);
      const response = await handlePush(
        mongo,
        { storeId, deviceId: device.deviceId },
        {
          deviceId: device.deviceId,
          appVersion: "1.0.0",
          ops: [
            {
              operationId: randomUUID(),
              type: "setting.set",
              schemaVersion: 1,
              payload: {
                key: "receipt.footer",
                value: "set by the cashier",
                baseVersion: 0,
              },
              actorUserId: owner, // settings are for the owner only
              deviceId: device.deviceId,
              createdAt: new Date().toISOString(),
            },
          ],
        },
      );
      expect(response.results[0]).toMatchObject({ status: "applied" }); // the audit's finding
      // What should happen: it is not applied.
      expect(response.results[0].status).not.toBe("applied");
    },
  );
});

describe("QA H3: who can read people's PIN hashes", () => {
  knownBug(
    "the list sent to a device does not carry the owner's PIN hash",
    async () => {
      const staff = await listStaff(mongo.db, storeId);
      const theOwner = staff.find((s) => s.id === owner);
      expect(theOwner?.pinHash).toBeUndefined();
    },
  );
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
