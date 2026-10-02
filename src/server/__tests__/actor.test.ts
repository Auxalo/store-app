import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPin } from "@/auth/pin";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import {
  ACTOR_COOKIE,
  chooseActor,
  readActorCookie,
  signActor,
  unlockActor,
} from "../actor";

const SECRET = "x".repeat(40);
const DEVICE = "device-1";

let mongo: TestMongo;
let storeId: string;
let cashier: string;
let owner: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  const pin = await hashPin("1234");
  cashier = await mongo.seedUser(storeId, "cashier", {
    pinSalt: pin.salt,
    pinHash: pin.hash,
  });
  owner = await mongo.seedUser(storeId, "owner"); // no PIN
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const unlock = (
  pin: string,
  over: Partial<Parameters<typeof unlockActor>[1]> = {},
) =>
  unlockActor(mongo.db, {
    storeId,
    deviceId: DEVICE,
    userId: cashier,
    pin,
    secret: SECRET,
    ...over,
  });
const cookie = (value: string) =>
  `${ACTOR_COOKIE}=${encodeURIComponent(value)}`;

describe("the signed actor cookie", () => {
  const now = 1_000_000;
  const value = signActor(
    { userId: "u1", deviceId: DEVICE, expiresAt: now + 60_000 },
    SECRET,
  );

  it("vouches for the person on the device it was made for", () => {
    expect(readActorCookie(cookie(value), DEVICE, SECRET, now)).toBe("u1");
  });

  it("is refused on another device, after it expires, with a wrong secret, or when changed", () => {
    expect(
      readActorCookie(cookie(value), "other-device", SECRET, now),
    ).toBeNull();
    expect(
      readActorCookie(cookie(value), DEVICE, SECRET, now + 61_000),
    ).toBeNull();
    expect(
      readActorCookie(cookie(value), DEVICE, "y".repeat(40), now),
    ).toBeNull();
    const forged = value.replace("u1", "owner-id");
    expect(readActorCookie(cookie(forged), DEVICE, SECRET, now)).toBeNull();
    expect(readActorCookie(null, DEVICE, SECRET, now)).toBeNull();
    expect(readActorCookie("other=1", DEVICE, SECRET, now)).toBeNull();
    expect(readActorCookie(cookie("garbage"), DEVICE, SECRET, now)).toBeNull();
  });
});

describe("unlocking with a PIN on the server", () => {
  it("a right PIN (Bangla digits too) gives a cookie for that person on this device", async () => {
    const result = await unlock("১২৩৪");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      readActorCookie(cookie(result.cookieValue), DEVICE, SECRET, Date.now()),
    ).toBe(cashier);
    expect(
      readActorCookie(
        cookie(result.cookieValue),
        "elsewhere",
        SECRET,
        Date.now(),
      ),
    ).toBeNull();
  });

  it("refuses people who are unknown, from another shop, have no PIN, or are switched off", async () => {
    expect(await unlock("1234", { userId: "nobody" })).toMatchObject({
      ok: false,
      reason: "UNKNOWN_USER",
    });
    const otherStore = await mongo.seedStore("Other");
    expect(await unlock("1234", { storeId: otherStore })).toMatchObject({
      ok: false,
      reason: "UNKNOWN_USER",
    });
    expect(await unlock("1234", { userId: owner })).toMatchObject({
      ok: false,
      reason: "NO_PIN",
    });
    const pin = await hashPin("4321");
    const off = await mongo.seedUser(storeId, "cashier", {
      isActive: false,
      pinSalt: pin.salt,
      pinHash: pin.hash,
    });
    expect(await unlock("4321", { userId: off })).toMatchObject({
      ok: false,
      reason: "UNKNOWN_USER",
    });
  });

  it("counts wrong PINs, then makes the person wait, even for the right PIN, until the wait is over", async () => {
    const device = "counting-device";
    const t0 = 5_000_000;
    const run = (pin: string, now: number) =>
      unlock(pin, { deviceId: device, now });

    // Four free mistakes, each saying how many are left.
    for (let i = 1; i <= 4; i++)
      expect(await run("0000", t0 + i)).toMatchObject({
        ok: false,
        reason: "WRONG_PIN",
      });
    // The fifth starts the waiting (30 s).
    expect(await run("0000", t0 + 10)).toMatchObject({
      ok: false,
      reason: "LOCKED",
    });
    expect(await run("1234", t0 + 20_000)).toMatchObject({
      ok: false,
      reason: "LOCKED",
    });
    // After the wait, the right PIN works and clears the count.
    const ok = await run("1234", t0 + 60_000);
    expect(ok.ok).toBe(true);
    expect(await run("0000", t0 + 61_000)).toMatchObject({
      ok: false,
      reason: "WRONG_PIN",
      freeLeft: 4,
    });
  });

  it("asks for the password after many mistakes", async () => {
    const device = "attacked-device";
    let now = 9_000_000;
    let last: Awaited<ReturnType<typeof unlock>> | undefined;
    for (let i = 0; i < 16; i++) {
      now += 20 * 60_000; // always past any wait
      last = await unlock("0000", { deviceId: device, now });
    }
    expect(last).toMatchObject({ ok: false, reason: "NEEDS_PASSWORD" });
    now += 20 * 60_000;
    expect(await unlock("1234", { deviceId: device, now })).toMatchObject({
      ok: false,
      reason: "NEEDS_PASSWORD",
    });
  });
});

describe("who is acting", () => {
  it("in a shop that uses PINs, a request without an unlock is not allowed to act", async () => {
    const choice = await chooseActor(mongo.db, {
      storeId,
      deviceId: DEVICE,
      cookieHeader: null,
      secret: SECRET,
    });
    expect(choice).toEqual({ kind: "required" });
  });

  it("with a valid unlock, the unlocked person acts, with their role read from the database", async () => {
    const result = await unlock("1234");
    if (!result.ok) throw new Error("unlock failed");
    const choice = await chooseActor(mongo.db, {
      storeId,
      deviceId: DEVICE,
      cookieHeader: cookie(result.cookieValue),
      secret: SECRET,
    });
    expect(choice).toMatchObject({
      kind: "pin",
      user: { id: cashier, role: "cashier", storeId },
    });
  });

  it("an unlock for someone who has since been switched off is refused", async () => {
    const pin = await hashPin("5555");
    const temp = await mongo.seedUser(storeId, "cashier", {
      pinSalt: pin.salt,
      pinHash: pin.hash,
    });
    const result = await unlock("5555", { userId: temp });
    if (!result.ok) throw new Error("unlock failed");
    await mongo.db
      .collection("user")
      .updateOne(
        { _id: (await import("mongodb")).ObjectId.createFromHexString(temp) },
        { $set: { isActive: false } },
      );
    expect(
      await chooseActor(mongo.db, {
        storeId,
        deviceId: DEVICE,
        cookieHeader: cookie(result.cookieValue),
        secret: SECRET,
      }),
    ).toEqual({ kind: "invalid" });
  });

  it("an unlock cannot be used in another shop", async () => {
    const result = await unlock("1234");
    if (!result.ok) throw new Error("unlock failed");
    const otherStore = await mongo.seedStore("Elsewhere");
    expect(
      await chooseActor(mongo.db, {
        storeId: otherStore,
        deviceId: DEVICE,
        cookieHeader: cookie(result.cookieValue),
        secret: SECRET,
      }),
    ).toEqual({ kind: "invalid" });
  });

  it("in a shop with no PINs, the signed-in account is the person working", async () => {
    const quiet = await mongo.seedStore("Quiet");
    await mongo.seedUser(quiet, "owner");
    expect(
      await chooseActor(mongo.db, {
        storeId: quiet,
        deviceId: DEVICE,
        cookieHeader: null,
        secret: SECRET,
      }),
    ).toEqual({ kind: "account" });
  });
});
