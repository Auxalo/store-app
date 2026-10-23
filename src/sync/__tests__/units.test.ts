import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { createDevice } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { pullAll } from "../engine";

/** Saving, renaming, removing and restoring a unit: the same on a device and on the server. */

let mongo: TestMongo;
let storeId: string;
let ownerId: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  ownerId = await mongo.seedUser(storeId, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const newDevice = () => createDevice(mongo, storeId, "owner", ownerId);
const serverUnit = (code: string) =>
  mongo.db
    .collection("settings")
    .findOne({ _id: `${storeId}:unit.${code}` as never });

const save = (
  d: Awaited<ReturnType<typeof newDevice>>,
  code: string,
  patch: Partial<{
    name: string;
    decimals: 0 | 1 | 2 | 3;
    removed: boolean;
  }> = {},
) =>
  runCommand(d.db, d.ctx, "unit.save", {
    code,
    name: "বস্তা",
    decimals: 0,
    removed: false,
    ...patch,
  });

async function productIn(
  d: Awaited<ReturnType<typeof newDevice>>,
  unit: string,
) {
  const id = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id,
    name: "চাল",
    nameBn: "",
    unit,
    sellingPrice: 300_000,
    purchasePrice: 250_000,
    openingStock: 5_000,
    openingMovementId: newId(),
  });
  return id;
}

describe("unit.save", () => {
  it("adds, renames and changes a unit; it reaches the server and a second device", async () => {
    const a = await newDevice();
    const code = `u_${newId().replace(/-/g, "")}`;
    await save(a, code);
    await save(a, code, { name: "বস্তা (৫০ কেজি)", decimals: 3 });
    expect((await a.db.settings.get(`unit.${code}`))?.value).toEqual({
      name: "বস্তা (৫০ কেজি)",
      decimals: 3,
      removed: false,
    });
    await a.sync();
    expect((await serverUnit(code))?.value).toEqual({
      name: "বস্তা (৫০ কেজি)",
      decimals: 3,
      removed: false,
    });

    const b = await newDevice();
    await pullAll(b.db, b.transport);
    expect((await b.db.settings.get(`unit.${code}`))?.value).toMatchObject({
      name: "বস্তা (৫০ কেজি)",
    });
  });

  it("a built-in unit can be renamed and removed like any other", async () => {
    const d = await newDevice();
    await save(d, "dozen", { name: "ডজন", removed: true });
    expect((await d.db.settings.get("unit.dozen"))?.value).toMatchObject({
      removed: true,
    });
    await d.sync();
    expect((await serverUnit("dozen"))?.value).toMatchObject({ removed: true });
  });

  it("refuses a name that is empty for a shop's own unit", async () => {
    const d = await newDevice();
    await expect(
      save(d, `u_${newId().replace(/-/g, "")}`, { name: " " }),
    ).rejects.toThrow();
    // A built-in unit may keep its translated name (an empty name).
    await expect(save(d, "kg", { name: "" })).resolves.toBeDefined();
  });
});

describe("removing a unit a product still uses", () => {
  it("is refused on the device, and allowed once the product moves to another unit", async () => {
    const d = await newDevice();
    const code = `u_${newId().replace(/-/g, "")}`;
    await save(d, code);
    const productId = await productIn(d, code);

    await expect(save(d, code, { removed: true })).rejects.toThrow(
      /UNIT_IN_USE/,
    );

    // Move the product to another unit, then the removal goes through.
    await runCommand(d.db, d.ctx, "product.update", {
      id: productId,
      changes: { unit: "pcs" },
    });
    await save(d, code, { removed: true });
    expect((await d.db.settings.get(`unit.${code}`))?.value).toMatchObject({
      removed: true,
    });

    // Restoring brings it back.
    await save(d, code, { removed: false });
    expect((await d.db.settings.get(`unit.${code}`))?.value).toMatchObject({
      removed: false,
    });
  });

  it("is refused on the server when another device's product uses it", async () => {
    const a = await newDevice();
    const code = `u_${newId().replace(/-/g, "")}`;
    await save(a, code);
    await productIn(a, code);
    await a.sync();

    // A second device that has not seen the product asks to remove the unit.
    const b = await newDevice();
    await save(b, code, { removed: true });
    await b.sync();
    expect((await serverUnit(code))?.value).toMatchObject({ removed: false });
  });
});
