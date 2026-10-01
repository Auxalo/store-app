import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { findProductByCode, searchProducts } from "@/db/local/queries/products";
import { newId } from "@/lib/ids";
import { createDevice, type Device } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { pullAll } from "../engine";
import { resolveConflict } from "../resolve";

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

async function addProduct(d: Device, fields: Record<string, unknown> = {}) {
  const id = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id,
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    sellingPrice: 5000,
    purchasePrice: 4000,
    openingStock: 10_000,
    openingMovementId: newId(),
    ...fields,
  });
  return id;
}

const adjust = (
  d: Device,
  productId: string,
  qtyDelta: number,
  type: "adjustment" | "damage" | "correction" = "adjustment",
) =>
  runCommand(d.db, d.ctx, "stock.adjust", {
    productId,
    movementId: newId(),
    type,
    qtyDelta,
    note: "",
  });

const pending = (d: Device) =>
  d.db.outbox.where("status").anyOf("pending", "syncing").count();

describe("products on one device", () => {
  it("creates the product and its opening movement instantly, searchable by Bangla and English", async () => {
    const d = await newDevice();
    const id = await addProduct(d, { sku: "MLK-1", barcode: "8901234567890" });

    expect(await d.db.products.get(id)).toMatchObject({
      stock: 10_000,
      version: 1,
    });
    expect(
      await d.db.stockMovements.where("productId").equals(id).toArray(),
    ).toEqual([expect.objectContaining({ type: "opening", qtyDelta: 10_000 })]);
    expect(
      (await searchProducts(d.db, { query: "milk" })).map((p) => p.id),
    ).toEqual([id]);
    expect(
      (await searchProducts(d.db, { query: "দুধ" })).map((p) => p.id),
    ).toEqual([id]);
    expect(
      (await searchProducts(d.db, { query: "mlk" })).map((p) => p.id),
    ).toEqual([id]);
    expect((await findProductByCode(d.db, "8901234567890"))?.id).toBe(id);
  });

  it("an edit changes only the edited field", async () => {
    const d = await newDevice();
    const id = await addProduct(d);
    await runCommand(d.db, d.ctx, "product.update", {
      id,
      changes: { description: "Cold" },
    });
    expect(await d.db.products.get(id)).toMatchObject({
      description: "Cold",
      name: "Fresh Milk",
      sellingPrice: 5000,
      purchasePrice: 4000,
      stock: 10_000,
    });
  });

  it("keeps the search index in step with edits", async () => {
    const d = await newDevice();
    const id = await addProduct(d, { name: "Rice", nameBn: "" });
    await runCommand(d.db, d.ctx, "product.update", {
      id,
      changes: { nameBn: "চাল", barcode: "123456" },
    });
    expect(
      (await searchProducts(d.db, { query: "চাল" })).map((p) => p.id),
    ).toEqual([id]);
    expect((await findProductByCode(d.db, "123456"))?.id).toBe(id);
  });

  it("shows stock immediately and matches the ledger", async () => {
    const d = await newDevice();
    const id = await addProduct(d);
    await adjust(d, id, -2_500, "damage");
    await adjust(d, id, 500, "correction");
    const product = await d.db.products.get(id);
    const ledger = await d.db.stockMovements
      .where("productId")
      .equals(id)
      .toArray();
    expect(product?.stock).toBe(8_000);
    expect(ledger.reduce((sum, m) => sum + m.qtyDelta, 0)).toBe(product?.stock);
  });
});

describe("products across devices", () => {
  it("delivers the product, its stock and its movements to a second device, with search ready", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const id = await addProduct(a);
    await adjust(a, id, -1_000);
    await a.sync();
    await b.sync();

    expect(await b.db.products.get(id)).toMatchObject({
      stock: 9_000,
      version: 2,
      name: "Fresh Milk",
    });
    expect(
      await b.db.stockMovements.where("productId").equals(id).count(),
    ).toBe(2);
    expect(
      (await searchProducts(b.db, { query: "ফ্রেশ" })).map((p) => p.id),
    ).toEqual([id]);
  });

  it("adds up stock adjustments made offline on two devices", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const id = await addProduct(a);
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    b.faults.offline = true;
    await adjust(a, id, 5_000); // received 5 more
    await adjust(b, id, -2_000); // sold 2
    await adjust(b, id, -1_000, "damage");
    expect((await a.db.products.get(id))?.stock).toBe(15_000);
    expect((await b.db.products.get(id))?.stock).toBe(7_000);

    a.faults.offline = false;
    b.faults.offline = false;
    await a.sync();
    await b.sync();
    await a.sync();

    expect((await a.db.products.get(id))?.stock).toBe(12_000);
    expect((await b.db.products.get(id))?.stock).toBe(12_000);
    expect(
      (await mongo.db.collection("products").findOne({ _id: id as never }))
        ?.stock,
    ).toBe(12_000);
    for (const device of [a, b]) {
      const ledger = await device.db.stockMovements
        .where("productId")
        .equals(id)
        .toArray();
      expect(ledger.reduce((sum, m) => sum + m.qtyDelta, 0)).toBe(12_000);
    }
  });

  it("keeps unsynced stock movements visible when another device's stock arrives first", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const id = await addProduct(a);
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    await adjust(a, id, -4_000); // A sold 4, not yet synced
    await adjust(b, id, 3_000); // B received 3
    await b.sync();

    a.faults.offline = false;
    await pullAll(a.db, a.transport);
    // Server says 13,000 (10 + 3); A's unsynced −4 is still counted.
    expect((await a.db.products.get(id))?.stock).toBe(9_000);

    await a.sync();
    expect(await pending(a)).toBe(0);
    expect((await a.db.products.get(id))?.stock).toBe(9_000);
  });

  it("survives a lost acknowledgement without double-counting stock", async () => {
    const d = await newDevice();
    const id = await addProduct(d);
    await d.sync();
    await adjust(d, id, -1_500);
    d.faults.dropNextResponses = 1;
    await expect(d.sync()).rejects.toThrow();
    await d.db.outbox
      .where("status")
      .equals("pending")
      .modify({ nextAttemptAt: 0 });
    await d.sync();
    expect(
      (await mongo.db.collection("products").findOne({ _id: id as never }))
        ?.stock,
    ).toBe(8_500);
    expect((await d.db.products.get(id))?.stock).toBe(8_500);
  });

  it("merges an edit and a stock change made at the same time", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const id = await addProduct(a);
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    b.faults.offline = true;
    await runCommand(a.db, a.ctx, "product.update", {
      id,
      changes: { name: "Milk 1L" },
    });
    await adjust(b, id, -1_000);
    a.faults.offline = false;
    b.faults.offline = false;
    await a.sync();
    await b.sync();
    await a.sync();

    for (const device of [a, b]) {
      expect(await device.db.products.get(id)).toMatchObject({
        name: "Milk 1L",
        stock: 9_000,
      });
    }
  });
});

describe("price conflicts", () => {
  async function priceConflict() {
    const a = await newDevice();
    const b = await newDevice();
    const id = await addProduct(a);
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    b.faults.offline = true;
    await runCommand(a.db, a.ctx, "product.update", {
      id,
      changes: { sellingPrice: 5500 },
    });
    await runCommand(b.db, b.ctx, "product.update", {
      id,
      changes: { sellingPrice: 6000 },
    });
    a.faults.offline = false;
    b.faults.offline = false;
    await a.sync(); // A reaches the server first and wins
    await b.sync(); // B's edit clashes
    return { a, b, id };
  }

  it("stops at a conflict instead of choosing silently, and shows the user's own value meanwhile", async () => {
    const { b, id } = await priceConflict();
    const [op] = await b.db.outbox.where("status").equals("conflict").toArray();
    expect(op).toMatchObject({ type: "product.update", lastError: "CONFLICT" });
    expect(op.serverDoc).toMatchObject({ sellingPrice: 5500 });
    expect((await b.db.products.get(id))?.sellingPrice).toBe(6000);
    expect(
      (await mongo.db.collection("products").findOne({ _id: id as never }))
        ?.sellingPrice,
    ).toBe(5500);
  });

  it("'keep the other version' restores the server's price", async () => {
    const { b, id } = await priceConflict();
    const [op] = await b.db.outbox.where("status").equals("conflict").toArray();
    await resolveConflict(b.db, op.operationId, "server");
    expect((await b.db.products.get(id))?.sellingPrice).toBe(5500);
    expect(await b.db.outbox.where("status").equals("conflict").count()).toBe(
      0,
    );
  });

  it("'keep mine' re-sends the edit on top of the server's version and it wins", async () => {
    const { a, b, id } = await priceConflict();
    const [op] = await b.db.outbox.where("status").equals("conflict").toArray();
    await resolveConflict(b.db, op.operationId, "mine");
    await b.sync();
    await a.sync();
    expect(
      (await mongo.db.collection("products").findOne({ _id: id as never }))
        ?.sellingPrice,
    ).toBe(6000);
    expect((await a.db.products.get(id))?.sellingPrice).toBe(6000);
    expect((await b.db.products.get(id))?.sellingPrice).toBe(6000);
  });
});
