import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { clearStoreCaches } from "../cache";
import { requireDevice } from "../device-request";
import {
  checkDevice,
  DEVICE_COOKIE,
  deviceCookieValue,
  registerDevice,
} from "../devices";
import { HttpError } from "../http";
import { shopIsSuspended } from "../shop-status";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
let storeId: string;
let owner: string;
let cookie: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  owner = await mongo.seedUser(storeId, "owner");
  const deviceId = randomUUID();
  const registration = await registerDevice(mongo.db, {
    storeId,
    userId: owner,
    deviceId,
    name: "Test",
    existing: { ok: false, reason: "missing" },
  });
  cookie = `${DEVICE_COOKIE}=${deviceCookieValue(deviceId, registration.token as string)}`;
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const request = () =>
  new Request("http://localhost/api/x", { headers: { cookie } });
const setStatus = async (status: "active" | "suspended") => {
  await mongo.db
    .collection<{ _id: string }>("stores")
    .updateOne({ _id: storeId }, { $set: { status } });
  clearStoreCaches(); // what the server that pauses or resumes a shop does
};

describe("a paused shop", () => {
  it("works normally while active", async () => {
    expect(await shopIsSuspended(mongo.db, storeId)).toBe(false);
    expect((await checkDevice(mongo.db, cookie)).ok).toBe(true);
    expect((await requireDevice(request(), mongo.db, "read")).storeId).toBe(
      storeId,
    );
  });

  it("is refused by every device check with SHOP_SUSPENDED, and works again when resumed", async () => {
    await setStatus("suspended");
    expect(await shopIsSuspended(mongo.db, storeId)).toBe(true);
    expect(await checkDevice(mongo.db, cookie)).toEqual({
      ok: false,
      reason: "suspended",
    });
    await expect(
      requireDevice(request(), mongo.db, "write"),
    ).rejects.toMatchObject({
      status: 403,
      code: "SHOP_SUSPENDED",
    });

    await setStatus("active");
    expect((await checkDevice(mongo.db, cookie)).ok).toBe(true);
  });

  it("only affects its own shop", async () => {
    const other = await mongo.seedStore("Other");
    await setStatus("suspended");
    expect(await shopIsSuspended(mongo.db, other)).toBe(false);
    await setStatus("active");
  });

  it("an unknown device is still the old answer, not 'suspended'", async () => {
    await expect(
      requireDevice(new Request("http://localhost/x"), mongo.db, "read"),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
