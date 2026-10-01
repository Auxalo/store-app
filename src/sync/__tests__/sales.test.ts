import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { getMeta, setMeta } from "@/db/local/meta";
import { newId } from "@/lib/ids";
import { createDevice, type Device } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { pullAll } from "../engine";

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

async function addProduct(d: Device, stock = 10_000, name = "Fresh Milk") {
  const id = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id,
    name,
    nameBn: "ফ্রেশ দুধ",
    sellingPrice: 5000,
    purchasePrice: 4000,
    openingStock: stock,
    openingMovementId: newId(),
  });
  return id;
}

async function addCustomer(d: Device) {
  const id = newId();
  await runCommand(d.db, d.ctx, "customer.create", {
    id,
    name: "রহিম",
    phone: "01700000000",
  });
  return id;
}

const lineOf = (productId: string, qty: number, name = "Fresh Milk") => ({
  productId,
  productName: name,
  productNameBn: "",
  unit: "pcs" as const,
  qty,
  listPrice: 5000,
  unitPrice: 5000,
  unitCost: 4000,
  discount: 0,
});

async function sell(
  d: Device,
  lines: ReturnType<typeof lineOf>[],
  extra: Record<string, unknown> = {},
) {
  const id = newId();
  await runCommand(d.db, d.ctx, "sale.create", {
    id,
    lines,
    tendered: 1_000_000,
    ...extra,
  });
  return id;
}

const pending = (d: Device) =>
  d.db.outbox.where("status").anyOf("pending", "syncing").count();
const stock = async (d: Device, id: string) =>
  (await d.db.products.get(id))?.stock;

describe("selling on one device", () => {
  it("takes effect instantly: sale, lines, stock and movements, with a numbered invoice", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 10_000);
    const id = await sell(d, [lineOf(milk, 2000)]);

    const sale = await d.db.sales.get(id);
    expect(sale).toMatchObject({
      total: 10_000,
      paid: 10_000,
      due: 0,
      status: "active",
      itemCount: 1,
    });
    expect(sale?.invoiceNo).toMatch(/^[0-9A-F]{4}-\d{4}-0001$/); // no device code yet: id prefix
    expect(await d.db.saleItems.where("saleId").equals(id).toArray()).toEqual([
      expect.objectContaining({
        productId: milk,
        qty: 2000,
        lineTotal: 10_000,
      }),
    ]);
    expect(await stock(d, milk)).toBe(8_000);
    expect(
      await d.db.stockMovements.where("productId").equals(milk).count(),
    ).toBe(2); // opening + sale
  });

  it("numbers invoices in sequence with the device code, per month", async () => {
    const d = await newDevice();
    await setMeta(d.db, "deviceCode", "A");
    const milk = await addProduct(d);
    const first = await d.db.sales.get(await sell(d, [lineOf(milk, 1000)]));
    const second = await d.db.sales.get(await sell(d, [lineOf(milk, 1000)]));
    expect(first?.invoiceNo).toMatch(/^A-\d{4}-0001$/);
    expect(second?.invoiceNo).toMatch(/^A-\d{4}-0002$/);
    expect(await getMeta(d.db, "invoiceSeq")).toBeTruthy();
  });

  it("records what is owed as the customer's due", async () => {
    const d = await newDevice();
    const milk = await addProduct(d);
    const customer = await addCustomer(d);
    await sell(d, [lineOf(milk, 3000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 4_000,
    });
    expect((await d.db.customers.get(customer))?.balance).toBe(11_000);
    const ledger = await d.db.ledgerEntries
      .where("partyId")
      .equals(customer)
      .toArray();
    expect(ledger.map((e) => e.amountDelta)).toEqual([11_000]);
  });

  it("refuses an unpaid sale with no customer and changes nothing", async () => {
    const d = await newDevice();
    const milk = await addProduct(d);
    const before = await d.db.outbox.count();
    await expect(
      sell(d, [lineOf(milk, 1000)], { tendered: 0 }),
    ).rejects.toThrow();
    expect(await d.db.sales.count()).toBe(0);
    expect(await stock(d, milk)).toBe(10_000);
    expect(await d.db.outbox.count()).toBe(before);
  });
});

describe("sales across devices", () => {
  it("syncs a whole offline shift without duplicates and with correct stock", async () => {
    const a = await newDevice();
    const milk = await addProduct(a, 100_000);
    await a.sync();

    a.faults.offline = true;
    const ids: string[] = [];
    for (let i = 0; i < 12; i++)
      ids.push(await sell(a, [lineOf(milk, 1000 + (i % 3) * 500)]));
    const soldMilli = ids.reduce((_, __, i) => _ + 1000 + (i % 3) * 500, 0);
    expect(await pending(a)).toBe(12);
    expect(await stock(a, milk)).toBe(100_000 - soldMilli);

    a.faults.offline = false;
    a.faults.flaky = 0.5; // an unreliable connection while it syncs
    for (let attempt = 0; attempt < 300 && (await pending(a)) > 0; attempt++) {
      await a.db.outbox
        .where("status")
        .equals("pending")
        .modify({ nextAttemptAt: 0 });
      await a.sync().catch(() => undefined);
    }
    a.faults.flaky = 0;
    await a.sync();

    expect(await pending(a)).toBe(0);
    expect(
      await mongo.db
        .collection("sales")
        .countDocuments({ _id: { $in: ids } as never }),
    ).toBe(12);
    expect(
      (await mongo.db.collection("products").findOne({ _id: milk as never }))
        ?.stock,
    ).toBe(100_000 - soldMilli);
    expect(await stock(a, milk)).toBe(100_000 - soldMilli);
  });

  it("a second device receives sales with their lines, and the stock that resulted", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 10_000);
    const id = await sell(a, [lineOf(milk, 2000)]);
    await a.sync();
    await b.sync();

    expect(await b.db.sales.get(id)).toMatchObject({
      total: 10_000,
      status: "active",
    });
    expect(await b.db.saleItems.where("saleId").equals(id).count()).toBe(1);
    expect(await stock(b, milk)).toBe(8_000);
    expect(
      await b.db.stockMovements.where("productId").equals(milk).count(),
    ).toBe(2);
  });

  it("two devices selling at once both keep their sales; stock adds up; invoice numbers differ", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 10_000);
    await a.sync();
    await b.sync();
    await setMeta(a.db, "deviceCode", "A");
    await setMeta(b.db, "deviceCode", "B");

    a.faults.offline = true;
    b.faults.offline = true;
    const sa = await sell(a, [lineOf(milk, 3000)]);
    const sb = await sell(b, [lineOf(milk, 4000)]);
    const invoiceA = (await a.db.sales.get(sa))?.invoiceNo;
    const invoiceB = (await b.db.sales.get(sb))?.invoiceNo;
    expect(invoiceA).not.toBe(invoiceB);

    a.faults.offline = false;
    b.faults.offline = false;
    await a.sync();
    await b.sync();
    await a.sync();

    expect(await stock(a, milk)).toBe(3_000);
    expect(await stock(b, milk)).toBe(3_000);
    for (const d of [a, b]) {
      expect(await d.db.sales.get(sa)).toBeTruthy();
      expect(await d.db.sales.get(sb)).toBeTruthy();
    }
  });

  it("two devices selling the last item leave negative stock rather than losing a sale", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 1_000);
    await a.sync();
    await b.sync();
    a.faults.offline = true;
    b.faults.offline = true;
    await sell(a, [lineOf(milk, 1000)]);
    await sell(b, [lineOf(milk, 1000)]);
    a.faults.offline = false;
    b.faults.offline = false;
    await a.sync();
    await b.sync();
    await a.sync();
    expect(await stock(a, milk)).toBe(-1_000);
    expect(await stock(b, milk)).toBe(-1_000);
  });

  it("keeps an unsynced sale on screen when another device's stock change arrives first", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 10_000);
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    await sell(a, [lineOf(milk, 2000)]); // A sold 2, unsynced
    await runCommand(b.db, b.ctx, "stock.adjust", {
      productId: milk,
      movementId: newId(),
      type: "adjustment",
      qtyDelta: 5_000,
      note: "",
    });
    await b.sync();

    a.faults.offline = false;
    await pullAll(a.db, a.transport);
    expect(await stock(a, milk)).toBe(13_000); // 10 + 5 from B, minus A's pending 2

    await a.sync();
    expect(await pending(a)).toBe(0);
    expect(await stock(a, milk)).toBe(13_000);
  });

  it("shows an unsynced credit sale in the customer's balance after a pull", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 10_000);
    const customer = await addCustomer(a);
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    await sell(a, [lineOf(milk, 1000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 0,
    }); // 5000 due
    await sell(b, [lineOf(milk, 1000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 2_000,
    }); // 3000 due
    await b.sync();
    a.faults.offline = false;
    await pullAll(a.db, a.transport);
    expect((await a.db.customers.get(customer))?.balance).toBe(8_000);
    await a.sync();
    expect(
      (
        await mongo.db
          .collection("customers")
          .findOne({ _id: customer as never })
      )?.balance,
    ).toBe(8_000);
  });

  it("does not double-count a sale whose acknowledgement was lost", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 10_000);
    await d.sync();
    await sell(d, [lineOf(milk, 2500)]);
    d.faults.dropNextResponses = 1;
    await expect(d.sync()).rejects.toThrow();
    await d.db.outbox
      .where("status")
      .equals("pending")
      .modify({ nextAttemptAt: 0 });
    await d.sync();
    expect(
      (await mongo.db.collection("products").findOne({ _id: milk as never }))
        ?.stock,
    ).toBe(7_500);
    expect(await stock(d, milk)).toBe(7_500);
  });
});

describe("voiding a sale", () => {
  it("restores stock and the customer's due on every device", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 10_000);
    const customer = await addCustomer(a);
    const id = await sell(a, [lineOf(milk, 4000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 5_000,
    });
    await a.sync();
    await b.sync();
    expect(await stock(b, milk)).toBe(6_000);
    expect((await b.db.customers.get(customer))?.balance).toBe(15_000);

    // B cancels the sale; A finds out on its next sync.
    await runCommand(b.db, b.ctx, "sale.void", {
      saleId: id,
      reason: "wrong item",
    });
    expect((await b.db.sales.get(id))?.status).toBe("voided");
    expect(await stock(b, milk)).toBe(10_000);
    expect((await b.db.customers.get(customer))?.balance).toBe(0);
    await b.sync();
    await a.sync();

    expect(await a.db.sales.get(id)).toMatchObject({
      status: "voided",
      voidReason: "wrong item",
      total: 20_000,
    });
    expect(await stock(a, milk)).toBe(10_000);
    expect((await a.db.customers.get(customer))?.balance).toBe(0);
    const ledger = await a.db.ledgerEntries
      .where("partyId")
      .equals(customer)
      .toArray();
    expect(ledger.reduce((sum, e) => sum + e.amountDelta, 0)).toBe(0);
  });

  it("keeps a pending void visible when other changes arrive before it syncs", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 10_000);
    const id = await sell(a, [lineOf(milk, 2000)]);
    await a.sync();
    await b.sync();

    b.faults.offline = true;
    await runCommand(b.db, b.ctx, "sale.void", { saleId: id, reason: "" });
    await sell(a, [lineOf(milk, 1000)]); // A keeps selling
    await a.sync();
    b.faults.offline = false;
    await pullAll(b.db, b.transport);

    expect((await b.db.sales.get(id))?.status).toBe("voided"); // still shown as voided while pending
    expect(await stock(b, milk)).toBe(10_000 - 1_000); // +2 restored by B's pending void, −1 from A's later sale
    await b.sync();
    expect(await pending(b)).toBe(0);
    expect(
      (await mongo.db.collection("products").findOne({ _id: milk as never }))
        ?.stock,
    ).toBe(9_000);
  });

  it("cannot be voided twice", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 10_000);
    const id = await sell(d, [lineOf(milk, 1000)]);
    await runCommand(d.db, d.ctx, "sale.void", { saleId: id, reason: "" });
    await expect(
      runCommand(d.db, d.ctx, "sale.void", { saleId: id, reason: "" }),
    ).rejects.toThrow();
    expect(await stock(d, milk)).toBe(10_000);
  });
});
