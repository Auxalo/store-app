import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { backfillSearchFields } from "@/server/backfill-search";
import { handlePull } from "@/server/sync/pull";
import { createDevice } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";

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

const col = (name: string) => mongo.db.collection(name);

describe("search fields across device and server", () => {
  it("are stored with each record on the server, never sent to devices, and the same on every device", async () => {
    const a = await createDevice(mongo, storeId, "owner", ownerId);
    const b = await createDevice(mongo, storeId, "owner", ownerId);

    const productId = newId();
    await runCommand(a.db, a.ctx, "product.create", {
      id: productId,
      name: "Miniket Rice",
      nameBn: "মিনিকেট চাল",
      purchasePrice: 6800,
      sellingPrice: 7500,
      openingStock: 100_000,
      openingMovementId: newId(),
    });
    const customerId = newId();
    await runCommand(a.db, a.ctx, "customer.create", {
      id: customerId,
      name: "রহিম উদ্দিন",
      phone: "01711000001",
    });
    const supplierId = newId();
    await runCommand(a.db, a.ctx, "supplier.create", {
      id: supplierId,
      name: "করিম ট্রেডার্স",
      phone: "01811000003",
    });
    const saleId = newId();
    await runCommand(a.db, a.ctx, "sale.create", {
      id: saleId,
      customerId,
      customerName: "রহিম উদ্দিন",
      tendered: 7500,
      lines: [
        {
          productId,
          productName: "Miniket Rice",
          productNameBn: "মিনিকেট চাল",
          unit: "kg",
          qty: 1000,
          listPrice: 7500,
          unitPrice: 7500,
          unitCost: 6800,
          discount: 0,
        },
      ],
    });
    const purchaseId = newId();
    await runCommand(a.db, a.ctx, "purchase.create", {
      id: purchaseId,
      supplierId,
      supplierName: "করিম ট্রেডার্স",
      invoiceRef: "INV-99",
      date: "2026-10-02",
      paid: 1_000_000,
      lines: [
        {
          productId,
          productName: "Miniket Rice",
          productNameBn: "",
          unit: "kg",
          qty: 10_000,
          unitCost: 6800,
          discount: 0,
        },
      ],
    });
    await a.sync();
    await b.sync();

    // The server keeps what it needs to search.
    const product = await col("products").findOne({ _id: productId as never });
    expect(product?.nameKey).toBe("miniket rice");
    expect(product?.searchWords).toEqual(
      expect.arrayContaining(["miniket", "চাল"]),
    );
    const sale = await col("sales").findOne({ _id: saleId as never });
    expect(sale?.customerPhone).toBe("01711000001");
    expect(sale?.searchWords).toEqual(
      expect.arrayContaining(["01711000001", "রহিম", "1"]),
    );
    expect(
      (await col("customers").findOne({ _id: customerId as never }))?.nameKey,
    ).toBe("রহিম উদ্দিন");
    expect(
      (await col("suppliers").findOne({ _id: supplierId as never }))?.nameKey,
    ).toBe("করিম ট্রেডার্স");
    expect(
      (await col("purchases").findOne({ _id: purchaseId as never }))
        ?.searchWords,
    ).toEqual(expect.arrayContaining(["inv", "99", "করিম"]));

    // Devices are not sent them (they work them out themselves)...
    const page = await handlePull(mongo.db, storeId, 0);
    for (const docs of Object.values(page.changes))
      for (const doc of docs ?? []) {
        expect(doc).not.toHaveProperty("searchWords");
        expect(doc).not.toHaveProperty("nameKey");
      }

    // ...and the second device ends up with the same search fields as the first.
    expect((await b.db.sales.get(saleId))?.searchWords?.sort()).toEqual(
      (await a.db.sales.get(saleId))?.searchWords?.sort(),
    );
    expect(await b.db.sales.get(saleId)).toMatchObject({
      customerPhone: "01711000001",
    });
    expect((await b.db.products.get(productId))?.nameKey).toBe("miniket rice");
    expect((await b.db.purchases.get(purchaseId))?.searchWords).toContain(
      "inv",
    );
  });

  it("follow a rename: the new name is found, the old one is not", async () => {
    const a = await createDevice(mongo, storeId, "owner", ownerId);
    const customerId = newId();
    await runCommand(a.db, a.ctx, "customer.create", {
      id: customerId,
      name: "Rahim",
      phone: "",
    });
    await a.sync();
    await runCommand(a.db, a.ctx, "customer.update", {
      id: customerId,
      changes: { name: "Abdur Rahim", phone: "01700000009" },
    });
    await a.sync();

    const server = await col("customers").findOne({ _id: customerId as never });
    expect(server?.nameKey).toBe("abdur rahim");
    expect(server?.searchWords).toEqual(
      expect.arrayContaining(["abdur", "rahim", "01700000009"]),
    );
    expect((await a.db.customers.get(customerId))?.nameKey).toBe("abdur rahim");
  });
});

describe("backfill of search fields on the server", () => {
  it("fills what older records lack, once, without telling devices anything changed", async () => {
    const oldStore = await mongo.seedStore("Old Store");
    await col("customers").insertOne({
      _id: "c-old" as never,
      storeId: oldStore,
      name: "রহিম",
      phone: "01711000001",
      syncSeq: 5,
      version: 1,
    } as never);
    await col("products").insertOne({
      _id: "p-old" as never,
      storeId: oldStore,
      name: "Salt",
      nameBn: "লবণ",
      sku: "S1",
      barcode: "",
      syncSeq: 6,
      version: 1,
    } as never);
    await col("sales").insertOne({
      _id: "s-old" as never,
      storeId: oldStore,
      invoiceNo: "A-2610-0042",
      customerId: "c-old",
      customerName: "রহিম",
      syncSeq: 7,
      version: 1,
    } as never);
    await col("sales").insertOne({
      _id: "s-walkin" as never,
      storeId: oldStore,
      invoiceNo: "A-2610-0043",
      customerId: null,
      customerName: "",
      syncSeq: 8,
      version: 1,
    } as never);

    const first = await backfillSearchFields(mongo.db);
    expect(first.customers).toBeGreaterThanOrEqual(1);
    expect(first.sales).toBeGreaterThanOrEqual(2);

    const sale = await col("sales").findOne({ _id: "s-old" as never });
    expect(sale?.customerPhone).toBe("01711000001");
    expect(sale?.searchWords).toEqual(
      expect.arrayContaining(["42", "01711000001", "রহিম"]),
    );
    expect(
      (await col("sales").findOne({ _id: "s-walkin" as never }))?.customerPhone,
    ).toBe("");
    expect(
      (await col("products").findOne({ _id: "p-old" as never }))?.nameKey,
    ).toBe("salt");
    // Devices are not told: the pull cursor position of these records did not move.
    expect(
      (await col("customers").findOne({ _id: "c-old" as never }))?.syncSeq,
    ).toBe(5);

    const second = await backfillSearchFields(mongo.db);
    expect(second).toEqual({
      products: 0,
      customers: 0,
      suppliers: 0,
      sales: 0,
      purchases: 0,
    });
  });
});
