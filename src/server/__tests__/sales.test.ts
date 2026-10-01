import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OP_SCHEMA_VERSION } from "@/commands/definitions";
import { saleRecordIds } from "@/lib/sale-math";
import type { OpEnvelope, PushResult } from "@/schemas/sync";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { handlePull } from "../sync/pull";
import { handlePush } from "../sync/push";

let mongo: TestMongo;
let storeId: string;
let owner: string;
let manager: string;
let cashier: string;
const deviceA = randomUUID();
const deviceB = randomUUID();

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  owner = await mongo.seedUser(storeId, "owner");
  manager = await mongo.seedUser(storeId, "manager");
  cashier = await mongo.seedUser(storeId, "cashier");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

let clock = Date.parse("2026-10-02T10:00:00.000Z");
const tick = () => {
  clock += 1000;
  return new Date(clock).toISOString();
};

function op(
  type: string,
  payload: unknown,
  o: Partial<OpEnvelope> = {},
): OpEnvelope {
  return {
    operationId: randomUUID(),
    type,
    schemaVersion: OP_SCHEMA_VERSION,
    payload,
    actorUserId: owner,
    deviceId: deviceA,
    createdAt: tick(),
    ...o,
  };
}

async function push(
  device: string,
  ...ops: OpEnvelope[]
): Promise<PushResult[]> {
  const res = await handlePush(
    mongo,
    { storeId, deviceId: device },
    { deviceId: device, appVersion: "1.0.0", ops },
  );
  return res.results;
}

async function addProduct(stock = 10_000, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  await push(
    deviceA,
    op("product.create", {
      id,
      name: "Milk",
      nameBn: "দুধ",
      sku: "",
      barcode: "",
      categoryId: null,
      unit: "pcs",
      purchasePrice: 4000,
      sellingPrice: 5000,
      lowStockThreshold: 0,
      description: "",
      isActive: true,
      openingStock: stock,
      openingMovementId: randomUUID(),
      ...extra,
    }),
  );
  return id;
}

async function addCustomer() {
  const id = randomUUID();
  await push(
    deviceA,
    op("customer.create", {
      id,
      name: "রহিম",
      phone: "01700000000",
      address: "",
      notes: "",
    }),
  );
  return id;
}

const line = (
  productId: string,
  qty: number,
  over: Record<string, unknown> = {},
) => ({
  productId,
  productName: "Milk",
  productNameBn: "দুধ",
  unit: "pcs",
  qty,
  listPrice: 5000,
  unitPrice: 5000,
  unitCost: 4000,
  discount: 0,
  ...over,
});

let invoice = 0;
function sale(lines: unknown[], over: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    payload: {
      id,
      invoiceNo: `T-2610-${String(++invoice).padStart(4, "0")}`,
      customerId: null,
      customerName: "",
      lines,
      discount: 0,
      tendered: 1_000_000,
      paymentMethod: "cash",
      notes: "",
      ...over,
    },
  };
}

const col = (name: string) => mongo.db.collection(name);
const stockOf = async (id: string) =>
  (await col("products").findOne({ _id: id as never }))?.stock as number;
const balanceOf = async (id: string) =>
  (await col("customers").findOne({ _id: id as never }))?.balance as number;

describe("sale.create", () => {
  it("records the sale with its lines, computes totals itself, and takes stock out", async () => {
    const milk = await addProduct(10_000);
    const rice = await addProduct(8_000, { name: "Rice" });
    const s = sale(
      [
        line(milk, 2000),
        line(rice, 1000, { unitPrice: 4000, listPrice: 5000, discount: 100 }),
      ],
      { discount: 200 },
    );
    // The device is not trusted for money: a wrong total in the payload cannot change the result.
    const [result] = await push(
      deviceA,
      op("sale.create", s.payload, { actorUserId: manager }),
    );

    expect(result.status).toBe("applied");
    const stored = await col("sales").findOne({ _id: s.id as never });
    expect(stored).toMatchObject({
      subtotal: 13_900,
      discount: 200,
      total: 13_700,
      paid: 13_700,
      due: 0,
      status: "active",
      itemCount: 2,
    });
    expect(stored?.items).toHaveLength(2);
    expect(stored?.items[1]).toMatchObject({
      id: saleRecordIds.item(s.id, 1),
      lineTotal: 3_900,
      productId: rice,
    });
    expect(await stockOf(milk)).toBe(8_000);
    expect(await stockOf(rice)).toBe(7_000);
    expect(
      await col("stockMovements").countDocuments({ refId: s.id, type: "sale" }),
    ).toBe(2);
  });

  it("returns every record it changed so the device can update itself", async () => {
    const milk = await addProduct(5_000);
    const s = sale([line(milk, 1000)]);
    const [result] = await push(deviceA, op("sale.create", s.payload));
    const collections = (result.docs ?? []).map((d) => d.collection).sort();
    expect(collections).toEqual(["products", "sales", "stockMovements"]);
    expect(
      result.docs?.find((d) => d.collection === "products")?.doc,
    ).toMatchObject({ stock: 4_000 });
    expect(
      result.docs?.find((d) => d.collection === "sales")?.doc.items,
    ).toHaveLength(1);
  });

  it("applies once however many times it is retried", async () => {
    const milk = await addProduct(10_000);
    const s = sale([line(milk, 3000)]);
    const create = op("sale.create", s.payload);
    await push(deviceA, create);
    const [again] = await push(deviceA, create);
    expect(again.status).toBe("duplicate");
    expect(await stockOf(milk)).toBe(7_000);
    expect(await col("sales").countDocuments({ _id: s.id as never })).toBe(1);
  });

  it("does not take stock out twice if the same sale arrives under a new operation id", async () => {
    const milk = await addProduct(10_000);
    const s = sale([line(milk, 1000)]);
    await push(deviceA, op("sale.create", s.payload));
    const [second] = await push(deviceA, op("sale.create", s.payload));
    expect(second.status).toBe("applied");
    expect(await stockOf(milk)).toBe(9_000);
  });

  it("moves the stock once, by the total, when a product is on several lines", async () => {
    const milk = await addProduct(10_000);
    const s = sale([line(milk, 1000), line(milk, 2000, { discount: 50 })]);
    await push(deviceA, op("sale.create", s.payload));
    expect(await stockOf(milk)).toBe(7_000);
    expect(
      (await col("products").findOne({ _id: milk as never }))?.version,
    ).toBe(2);
    expect(await col("stockMovements").countDocuments({ refId: s.id })).toBe(2);
  });

  it("records an unpaid amount as the customer's due, matching the ledger", async () => {
    const milk = await addProduct(10_000);
    const customer = await addCustomer();
    const s = sale([line(milk, 2000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 3_000,
    });
    const [result] = await push(deviceA, op("sale.create", s.payload));
    expect(result.status).toBe("applied");
    expect(await col("sales").findOne({ _id: s.id as never })).toMatchObject({
      total: 10_000,
      paid: 3_000,
      due: 7_000,
    });
    expect(await balanceOf(customer)).toBe(7_000);
    const entries = await col("ledgerEntries")
      .find({ partyId: customer })
      .toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      amountDelta: 7_000,
      refType: "sale",
      _id: saleRecordIds.ledger(s.id),
    });
  });

  it("refuses a sale with money owed and nobody to owe it", async () => {
    const milk = await addProduct(10_000);
    const s = sale([line(milk, 1000)], { tendered: 0, customerId: null });
    const [result] = await push(deviceA, op("sale.create", s.payload));
    expect(result).toMatchObject({
      status: "rejected",
      error: "INVALID_PAYLOAD",
    });
    expect(await stockOf(milk)).toBe(10_000);
  });

  it("lets a cashier sell at list price but not change a price", async () => {
    const milk = await addProduct(10_000);
    const [normal] = await push(
      deviceA,
      op("sale.create", sale([line(milk, 1000)]).payload, {
        actorUserId: cashier,
      }),
    );
    expect(normal.status).toBe("applied");

    const cheat = sale([line(milk, 1000, { unitPrice: 1 })]);
    const [denied] = await push(
      deviceA,
      op("sale.create", cheat.payload, { actorUserId: cashier }),
    );
    expect(denied).toMatchObject({ status: "rejected", error: "FORBIDDEN" });
    expect(await col("sales").countDocuments({ _id: cheat.id as never })).toBe(
      0,
    );

    const [allowed] = await push(
      deviceA,
      op("sale.create", cheat.payload, { actorUserId: manager }),
    );
    expect(allowed.status).toBe("applied");
    expect(
      await col("auditLogs").countDocuments({
        entityId: cheat.id,
        action: "sale.priceOverride",
      }),
    ).toBe(1);
  });

  it("still records a sale of a product that was deleted meanwhile, without touching stock", async () => {
    const milk = await addProduct(10_000);
    const gone = await addProduct(5_000, { name: "Gone" });
    await push(deviceA, op("product.delete", { id: gone, baseVersion: 1 }));
    const s = sale([line(milk, 1000), line(gone, 1000)]);
    const [result] = await push(deviceA, op("sale.create", s.payload));
    expect(result.status).toBe("applied");
    expect(
      (await col("sales").findOne({ _id: s.id as never }))?.items,
    ).toHaveLength(2);
    expect(await stockOf(gone)).toBe(5_000);
    expect(await stockOf(milk)).toBe(9_000);
    expect(await col("stockMovements").countDocuments({ refId: s.id })).toBe(1);
  });

  it("lets two devices sell the last item: both sales stand and stock goes negative", async () => {
    const milk = await addProduct(1_000);
    const a = sale([line(milk, 1000)]);
    const b = sale([line(milk, 1000)]);
    await Promise.all([
      push(deviceA, op("sale.create", a.payload)),
      push(deviceB, op("sale.create", b.payload, { deviceId: deviceB })),
    ]);
    expect(await stockOf(milk)).toBe(-1_000);
    expect(
      await col("sales").countDocuments({
        _id: { $in: [a.id, b.id] } as never,
      }),
    ).toBe(2);
  });

  it("gives sale records distinct sequence numbers and exposes them through pull", async () => {
    const s0 = await mongo.seedStore("Pull sales");
    const u = await mongo.seedUser(s0, "owner");
    const productId = randomUUID();
    const s = sale([line(productId, 1000)]);
    await handlePush(
      mongo,
      { storeId: s0, deviceId: deviceA },
      {
        deviceId: deviceA,
        appVersion: "1.0.0",
        ops: [
          op(
            "product.create",
            {
              id: productId,
              name: "Milk",
              nameBn: "",
              sku: "",
              barcode: "",
              categoryId: null,
              unit: "pcs",
              purchasePrice: 0,
              sellingPrice: 5000,
              lowStockThreshold: 0,
              description: "",
              isActive: true,
              openingStock: 4_000,
              openingMovementId: randomUUID(),
            },
            { actorUserId: u },
          ),
          op("sale.create", s.payload, { actorUserId: u }),
        ],
      },
    );
    const page = await handlePull(mongo.db, s0, 0);
    expect(page.changes.sales).toHaveLength(1);
    expect(page.changes.sales[0]).toMatchObject({ id: s.id, total: 5_000 });
    expect(page.changes.products.at(-1)).toMatchObject({ stock: 3_000 });
    const seqs = [...Object.values(page.changes)].flat().map((d) => d.syncSeq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});

describe("sale.void", () => {
  async function dueSale() {
    const milk = await addProduct(10_000);
    const customer = await addCustomer();
    const s = sale([line(milk, 4000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 5_000,
    });
    await push(deviceA, op("sale.create", s.payload));
    return { milk, customer, s };
  }
  const voidOp = (
    s: { id: string },
    o: Partial<OpEnvelope> = {},
    reason = "wrong item",
  ) =>
    op(
      "sale.void",
      {
        saleId: s.id,
        reason,
        customerId: null,
        due: 0,
        lines: [{ productId: "x", qty: 1 }],
      },
      o,
    );

  it("puts stock back, reverses the customer's due and keeps the original sale", async () => {
    const { milk, customer, s } = await dueSale();
    expect(await stockOf(milk)).toBe(6_000);
    expect(await balanceOf(customer)).toBe(15_000);

    const [result] = await push(deviceA, voidOp(s));
    expect(result.status).toBe("applied");
    expect(await stockOf(milk)).toBe(10_000);
    expect(await balanceOf(customer)).toBe(0);
    expect(await col("sales").findOne({ _id: s.id as never })).toMatchObject({
      status: "voided",
      voidReason: "wrong item",
      total: 20_000,
    });

    const ledger = await col("ledgerEntries")
      .find({ partyId: customer })
      .toArray();
    expect(ledger.map((e) => e.amountDelta).sort((a, b) => a - b)).toEqual([
      -15_000, 15_000,
    ]);
    expect(ledger.reduce((sum, e) => sum + e.amountDelta, 0)).toBe(
      await balanceOf(customer),
    );
  });

  it("is idempotent and cannot be applied twice", async () => {
    const { milk, s } = await dueSale();
    await push(deviceA, voidOp(s));
    const [again] = await push(deviceA, voidOp(s)); // a different operation id for the same void
    expect(again.status).toBe("applied");
    expect(await stockOf(milk)).toBe(10_000);
    expect(
      await col("auditLogs").countDocuments({
        entityId: s.id,
        action: "sale.void",
      }),
    ).toBe(1);
  });

  it("is limited to people allowed to void, and needs the sale to exist", async () => {
    const { s } = await dueSale();
    const [denied] = await push(deviceA, voidOp(s, { actorUserId: cashier }));
    expect(denied).toMatchObject({ status: "rejected", error: "FORBIDDEN" });
    const [missing] = await push(deviceA, voidOp({ id: randomUUID() }));
    expect(missing).toMatchObject({ status: "rejected", error: "NOT_FOUND" });
  });
});
