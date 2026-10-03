import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import {
  listShops,
  logAdminAction,
  recentAdminActions,
  setShopStatus,
  shopDetail,
} from "../admin-shops";
import { clearStoreCaches } from "../cache";
import {
  checkDevice,
  DEVICE_COOKIE,
  deviceCookieValue,
  registerDevice,
} from "../devices";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
let alpha: string;
let beta: string;
const admin = { id: "op-1", name: "Operator One" };

beforeAll(async () => {
  mongo = await startMongo();
  alpha = await mongo.seedStore("Alpha Store");
  beta = await mongo.seedStore("Beta Traders");
  await mongo.seedUser(alpha, "owner", { name: "Alice", username: "alice" });
  await mongo.seedUser(alpha, "cashier", { name: "Carl", username: "carl" });
  await mongo.seedUser(beta, "owner", { name: "Bob", username: "bob" });
  await mongo.db.collection("products").insertMany([
    { _id: randomUUID(), storeId: alpha, name: "x", deletedAt: null },
    { _id: randomUUID(), storeId: alpha, name: "y", deletedAt: null },
    {
      _id: randomUUID(),
      storeId: alpha,
      name: "gone",
      deletedAt: "2026-01-01",
    },
    { _id: randomUUID(), storeId: beta, name: "z", deletedAt: null },
  ] as never[]);
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

describe("the operator's view of the shops", () => {
  it("lists every shop with its owner, and finds one by name", async () => {
    const all = await listShops(mongo.db);
    expect(all.map((s) => s.name).sort()).toEqual([
      "Alpha Store",
      "Beta Traders",
    ]);
    expect(all.find((s) => s.name === "Alpha Store")?.owner).toEqual({
      name: "Alice",
      username: "alice",
    });

    expect(
      (await listShops(mongo.db, { search: "beta" })).map((s) => s.name),
    ).toEqual(["Beta Traders"]);
    // Characters that mean something in a search pattern are just text.
    expect(await listShops(mongo.db, { search: ".*" })).toEqual([]);
  });

  it("shows one shop's size and people, and counts only its own records", async () => {
    const detail = await shopDetail(mongo.db, alpha);
    expect(detail?.counts.products).toBe(2); // not the deleted one, not Beta's
    expect(detail?.people.map((p) => p.username).sort()).toEqual([
      "alice",
      "carl",
    ]);
    expect(await shopDetail(mongo.db, "no-such-shop")).toBeNull();
    expect(await shopDetail(mongo.db, "platform")).toBeNull();
  });

  it("pausing a shop refuses its devices at once, resuming brings them back, and both are logged", async () => {
    const deviceId = randomUUID();
    const registration = await registerDevice(mongo.db, {
      storeId: alpha,
      userId: "u",
      deviceId,
      name: "T",
      existing: { ok: false, reason: "missing" },
    });
    const cookie = `${DEVICE_COOKIE}=${deviceCookieValue(deviceId, registration.token as string)}`;
    clearStoreCaches();
    expect((await checkDevice(mongo.db, cookie)).ok).toBe(true);

    expect(await setShopStatus(mongo.db, admin, alpha, "suspended")).toBe(true);
    expect(await checkDevice(mongo.db, cookie)).toEqual({
      ok: false,
      reason: "suspended",
    });
    expect(
      (await listShops(mongo.db)).find((s) => s.id === alpha)?.status,
    ).toBe("suspended");
    expect((await listShops(mongo.db)).find((s) => s.id === beta)?.status).toBe(
      "active",
    );

    expect(await setShopStatus(mongo.db, admin, alpha, "active")).toBe(true);
    expect((await checkDevice(mongo.db, cookie)).ok).toBe(true);

    expect(
      await setShopStatus(mongo.db, admin, "no-such-shop", "suspended"),
    ).toBe(false);
    const actions = (await recentAdminActions(mongo.db)).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["shop.suspend", "shop.resume"]),
    );
  });

  it("keeps a record of what operators did, newest first", async () => {
    await logAdminAction(mongo.db, admin, "shop.export", alpha, "Alpha Store");
    const [latest] = await recentAdminActions(mongo.db);
    expect(latest).toMatchObject({
      action: "shop.export",
      storeId: alpha,
      admin: "Operator One",
    });
  });
});
