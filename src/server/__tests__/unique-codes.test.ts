import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { createDevice } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";

let mongo: TestMongo;
let storeId: string;
let owner: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  owner = await mongo.seedUser(storeId, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const productInput = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  name: "Milk",
  sellingPrice: 5000,
  purchasePrice: 4000,
  openingStock: 0,
  openingMovementId: randomUUID(),
  ...over,
});

describe("the database refuses a second live product with the same SKU or barcode", () => {
  it("two devices that each typed the same SKU: the second is refused with a clear reason", async () => {
    const a = await createDevice(mongo, storeId, "owner", owner);
    const b = await createDevice(mongo, storeId, "owner", owner);
    await runCommand(
      a.db,
      a.ctx,
      "product.create",
      productInput({ sku: "DUP-1" }),
    );
    await a.sync();
    await runCommand(
      b.db,
      b.ctx,
      "product.create",
      productInput({ sku: "DUP-1" }),
    );
    await b.sync();

    const ops = await b.db.outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      status: "failed",
      lastError: "DUPLICATE_SKU",
    });
    expect(
      await mongo.db
        .collection("products")
        .countDocuments({ storeId, sku: "DUP-1" }),
    ).toBe(1);
  });

  it("the same for a barcode", async () => {
    const a = await createDevice(mongo, storeId, "owner", owner);
    const b = await createDevice(mongo, storeId, "owner", owner);
    await runCommand(
      a.db,
      a.ctx,
      "product.create",
      productInput({ barcode: "890-1" }),
    );
    await a.sync();
    await runCommand(
      b.db,
      b.ctx,
      "product.create",
      productInput({ barcode: "890-1" }),
    );
    await b.sync();
    expect((await b.db.outbox.toArray())[0]).toMatchObject({
      status: "failed",
      lastError: "DUPLICATE_BARCODE",
    });
  });

  it("empty codes never clash, another shop may reuse a code, and a deleted product frees its code", async () => {
    const col = mongo.db.collection("products");
    const base = (over: Record<string, unknown>) => ({
      _id: randomUUID(),
      storeId,
      name: "x",
      sku: "",
      barcode: "",
      deletedAt: null,
      ...over,
    });
    await col.insertMany([base({}), base({})] as never[]); // two with no code

    const other = await mongo.seedStore("Other");
    await col.insertOne(base({ storeId, sku: "REUSE-1" }) as never);
    await col.insertOne(base({ storeId: other, sku: "REUSE-1" }) as never); // another shop: fine
    await expect(
      col.insertOne(base({ sku: "REUSE-1" }) as never),
    ).rejects.toMatchObject({ code: 11000 });

    await col.updateOne(
      { storeId, sku: "REUSE-1" },
      { $set: { deletedAt: new Date().toISOString() } },
    );
    await col.insertOne(base({ sku: "REUSE-1" }) as never); // the deleted one freed it
  });
});
