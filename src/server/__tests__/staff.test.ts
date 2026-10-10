import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPin } from "@/auth/pin";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import {
  checkDevice,
  deviceCodeFor,
  listDevices,
  registerDevice,
  renameDevice,
  revokeDevice,
} from "../devices";
import { listAudit, listStaff, setStaffPin, updateStaff } from "../staff";
import { handlePull } from "../sync/pull";

let mongo: TestMongo;
let storeId: string;
let owner: string;
let cashier: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  owner = await mongo.seedUser(storeId, "owner", {
    name: "রহিম উদ্দিন",
    username: "rahim",
    displayUsername: "Rahim",
  });
  cashier = await mongo.seedUser(storeId, "cashier", {
    name: "করিম",
    username: "karim",
  });
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

describe("staff", () => {
  it("lists only this store's people, with role and active flag", async () => {
    const other = await mongo.seedStore("Other");
    await mongo.seedUser(other, "owner", { name: "Stranger" });
    const staff = await listStaff(mongo.db, storeId);
    expect(staff.map((s) => s.name).sort()).toEqual(
      ["করিম", "রহিম উদ্দিন"].sort(),
    );
    expect(staff.find((s) => s.id === owner)).toMatchObject({
      role: "owner",
      isActive: true,
      username: "Rahim",
    });
    expect(staff.find((s) => s.id === cashier)).toMatchObject({
      role: "cashier",
      isActive: true,
    });
  });

  it("changes a cashier's role and name, and can deactivate and reactivate them", async () => {
    const promoted = await updateStaff(mongo.db, storeId, cashier, {
      role: "manager",
      name: "করিম সাহেব",
    });
    expect(promoted).toMatchObject({
      ok: true,
      member: { role: "manager", name: "করিম সাহেব" },
    });
    const off = await updateStaff(mongo.db, storeId, cashier, {
      isActive: false,
    });
    expect(off).toMatchObject({ ok: true, member: { isActive: false } });
    const on = await updateStaff(mongo.db, storeId, cashier, {
      isActive: true,
      role: "cashier",
    });
    expect(on).toMatchObject({
      ok: true,
      member: { isActive: true, role: "cashier" },
    });
  });

  it("never lets the owner be demoted or deactivated, so a store always has its owner", async () => {
    expect(
      await updateStaff(mongo.db, storeId, owner, { role: "cashier" }),
    ).toEqual({ ok: false, error: "OWNER_PROTECTED" });
    expect(
      await updateStaff(mongo.db, storeId, owner, { isActive: false }),
    ).toEqual({ ok: false, error: "OWNER_PROTECTED" });
    expect(
      await updateStaff(mongo.db, storeId, owner, { name: "Renamed Owner" }),
    ).toMatchObject({ ok: true });
  });

  it("cannot touch people of another store, or people who do not exist", async () => {
    const other = await mongo.seedStore("Elsewhere");
    const foreign = await mongo.seedUser(other, "cashier");
    expect(
      await updateStaff(mongo.db, storeId, foreign, { isActive: false }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(
      await updateStaff(mongo.db, storeId, "not-an-id", { name: "x" }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(
      (await listStaff(mongo.db, other)).find((s) => s.id === foreign)
        ?.isActive,
    ).toBe(true);
  });

  it("stores a PIN hash for devices to check offline, never a PIN", async () => {
    const pin = await hashPin("4821");
    expect(await setStaffPin(mongo.db, storeId, cashier, pin)).toMatchObject({
      ok: true,
    });
    const member = (
      await listStaff(mongo.db, storeId, { userId: cashier })
    ).find((s) => s.id === cashier);
    expect(member).toMatchObject({
      pinSalt: pin.salt,
      pinHash: pin.hash,
      hasPin: true,
    });
    // The signing key is stored for the server, and never listed.
    expect(JSON.stringify(member)).not.toContain(pin.proof as string);
    expect(
      (
        await mongo.db
          .collection("user")
          .findOne({ _id: new ObjectId(cashier) })
      )?.pinProofKey,
    ).toBe(pin.proof);
    expect(JSON.stringify(member)).not.toContain("4821");
    expect(await setStaffPin(mongo.db, storeId, "ghost", pin)).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});

describe("the staff version devices use to know the people list changed", () => {
  const versionNow = async () =>
    (await handlePull(mongo.db, storeId, Number.MAX_SAFE_INTEGER)).staffVersion;

  it("moves when a person or a PIN changes, and not otherwise", async () => {
    const before = (await versionNow()) ?? 0;
    expect(await versionNow()).toBe(before); // asking changes nothing
    // (Saved with the same name, so what the later tests read is unchanged.)
    const current = (await listStaff(mongo.db, storeId)).find(
      (m) => m.id === cashier,
    );
    await updateStaff(mongo.db, storeId, cashier, { name: current?.name });
    const afterEdit = (await versionNow()) ?? 0;
    expect(afterEdit).toBe(before + 1);
    await setStaffPin(mongo.db, storeId, cashier, await hashPin("1234"));
    expect(await versionNow()).toBe(afterEdit + 1);
  });

  it("does not move for a refused change (someone else's person, or the owner's protected fields)", async () => {
    const before = await versionNow();
    await updateStaff(mongo.db, storeId, owner, { isActive: false });
    await updateStaff(mongo.db, storeId, new ObjectId().toHexString(), {
      name: "Nobody",
    });
    expect(await versionNow()).toBe(before);
  });
});

describe("audit trail", () => {
  it("returns the store's entries newest first with the person's name, and pages with `before`", async () => {
    const col = mongo.db.collection("auditLogs");
    const mk = (n: number, userId: string, storeId_ = storeId) => ({
      _id: randomUUID() as never,
      storeId: storeId_,
      userId,
      action: "stock.adjust",
      entity: "product",
      entityId: `p${n}`,
      at: new Date(Date.UTC(2026, 9, 2, 10, n)).toISOString(),
      newValue: { stock: n },
    });
    await col.insertMany([
      mk(1, owner),
      mk(2, cashier),
      mk(3, owner),
      mk(9, owner, "someone-elses-store"),
    ]);

    const page1 = await listAudit(mongo.db, storeId, 2);
    expect(page1.map((r) => r.entityId)).toEqual(["p3", "p2"]);
    expect(page1[0].userName).toBe("Renamed Owner");
    expect(page1[1].userName).toBe("করিম সাহেব");
    const page2 = await listAudit(mongo.db, storeId, 2, page1[1].at);
    expect(page2.map((r) => r.entityId)).toEqual(["p1"]);
  });
});

describe("devices", () => {
  const register = async (code?: string) => {
    const deviceId = randomUUID();
    const reg = await registerDevice(mongo.db, {
      storeId,
      userId: owner,
      deviceId,
      name: code ?? "Phone",
      existing: { ok: false, reason: "missing" },
    });
    return { deviceId, token: reg.token as string, code: reg.code };
  };
  const cookie = (d: { deviceId: string; token: string }) =>
    `sa_device=${d.deviceId}.${d.token}`;

  it("gives each new device the next short code", async () => {
    expect([1, 2, 26, 27, 28, 52, 53].map(deviceCodeFor)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
    ]);
    const a = await register();
    const b = await register();
    expect(a.code).not.toBe(b.code);
  });

  it("lists, renames and revokes devices; a revoked device is refused", async () => {
    const d = await register("Counter 1");
    expect((await checkDevice(mongo.db, cookie(d))).ok).toBe(true);

    expect(
      await renameDevice(mongo.db, storeId, d.deviceId, "Front counter"),
    ).toBe(true);
    const listed = (await listDevices(mongo.db, storeId)).find(
      (x) => x.id === d.deviceId,
    );
    expect(listed).toMatchObject({ name: "Front counter", revokedAt: null });

    expect(await revokeDevice(mongo.db, storeId, d.deviceId)).toBe(true);
    expect(await checkDevice(mongo.db, cookie(d))).toEqual({
      ok: false,
      reason: "revoked",
    });
    expect(await revokeDevice(mongo.db, storeId, d.deviceId)).toBe(false); // already revoked
    expect(
      (await listDevices(mongo.db, storeId)).find((x) => x.id === d.deviceId)
        ?.revokedAt,
    ).toBeTruthy();
  });

  it("cannot rename or revoke another store's device", async () => {
    const d = await register();
    const other = await mongo.seedStore("Elsewhere");
    expect(await revokeDevice(mongo.db, other, d.deviceId)).toBe(false);
    expect(await renameDevice(mongo.db, other, d.deviceId, "hijack")).toBe(
      false,
    );
    expect((await checkDevice(mongo.db, cookie(d))).ok).toBe(true);
  });

  it("refuses a device cookie with a wrong token or an unknown device", async () => {
    const d = await register();
    expect(
      await checkDevice(mongo.db, `sa_device=${d.deviceId}.wrong-token`),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await checkDevice(mongo.db, `sa_device=${randomUUID()}.abc`),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await checkDevice(mongo.db, null)).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});
