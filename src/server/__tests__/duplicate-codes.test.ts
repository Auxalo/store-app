import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { runOnlineCommand } from "../online-commands";

let mongo: TestMongo;
let storeId: string;
let otherStore: string;
let owner: string;
let otherOwner: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  otherStore = await mongo.seedStore("Other");
  owner = await mongo.seedUser(storeId, "owner");
  otherOwner = await mongo.seedUser(otherStore, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const run = (
  type: string,
  input: unknown,
  who: { id: string; store: string } = { id: owner, store: storeId },
  baseVersion?: number,
) =>
  runOnlineCommand(
    mongo,
    { id: who.id, role: "owner", storeId: who.store, deviceId: "d" },
    { operationId: randomUUID(), type, input, baseVersion },
  );

const create = (
  over: Record<string, unknown> = {},
  who?: { id: string; store: string },
) => {
  const id = randomUUID();
  return run(
    "product.create",
    {
      id,
      name: "Milk",
      purchasePrice: 4000,
      sellingPrice: 5000,
      openingStock: 0,
      openingMovementId: randomUUID(),
      ...over,
    },
    who,
  ).then((result) => ({ id, result }));
};

describe("a SKU or barcode belongs to one product of the shop", () => {
  it("refuses a second product with the same SKU, and the same barcode", async () => {
    expect((await create({ sku: "A100", barcode: "890001" })).result.ok).toBe(
      true,
    );

    const sku = (await create({ sku: "A100" })).result;
    expect(sku.ok).toBe(false);
    if (!sku.ok) expect(sku.code).toBe("DUPLICATE_SKU");

    const barcode = (await create({ sku: "A101", barcode: "890001" })).result;
    expect(barcode.ok).toBe(false);
    if (!barcode.ok) expect(barcode.code).toBe("DUPLICATE_BARCODE");
  });

  it("another shop may use the same codes", async () => {
    const result = (
      await create(
        { sku: "A100", barcode: "890001" },
        { id: otherOwner, store: otherStore },
      )
    ).result;
    expect(result.ok).toBe(true);
  });

  it("an edit may keep its own code but not take another product's", async () => {
    const first = await create({ sku: "B200" });
    const second = await create({ sku: "B201" });
    if (!first.result.ok || !second.result.ok) throw new Error("setup");

    const keep = await run(
      "product.update",
      { id: first.id, changes: { sku: "B200", name: "Milk 2" } },
      undefined,
      1,
    );
    expect(keep.ok).toBe(true);

    const take = await run(
      "product.update",
      { id: second.id, changes: { sku: "B200" } },
      undefined,
      1,
    );
    expect(take.ok).toBe(false);
    if (!take.ok) expect(take.code).toBe("DUPLICATE_SKU");
  });

  it("an empty code is never a clash", async () => {
    expect((await create({ sku: "C1", barcode: "" })).result.ok).toBe(true);
    expect((await create({ sku: "C2", barcode: "" })).result.ok).toBe(true);
  });
});
