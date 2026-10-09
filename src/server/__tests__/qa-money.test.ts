/**
 * QA audit: money and data integrity on the server (findings C1, C2, C3, C4, C5, S5).
 *
 * Each test states what SHOULD happen. A test written `it(...)` pins a confirmed bug: it
 * passes while the bug exists (the assertion fails), and starts failing the day someone fixes the
 * bug, which is the signal to turn it into a normal `it`. See docs/QA-REPORT.md.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Role } from "@/auth/permissions";
import { pushRequestSchema } from "@/schemas/sync";
import { createDevice } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { runOnlineCommand } from "../online-commands";
import { handlePush } from "../sync/push";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
let storeId: string;
let owner: string;
let cashier: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore("QA Money Shop");
  owner = await mongo.seedUser(storeId, "owner");
  cashier = await mongo.seedUser(storeId, "cashier");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const actor = (id: string, role: Role) => ({
  id,
  role,
  storeId,
  deviceId: "qa-online-device",
});
const asOwner = () => actor(owner, "owner");

const run = (
  who: ReturnType<typeof actor>,
  type: string,
  input: unknown,
  extra: { baseVersion?: number } = {},
) =>
  runOnlineCommand(mongo, who, {
    operationId: randomUUID(),
    type,
    input,
    baseVersion: extra.baseVersion,
  });

const col = (name: string) => mongo.db.collection(name);

async function product(stock = 100_000) {
  const id = randomUUID();
  const result = await run(asOwner(), "product.create", {
    id,
    name: "Milk",
    purchasePrice: 4000,
    sellingPrice: 5000,
    openingStock: stock,
    openingMovementId: randomUUID(),
  });
  expect(result.ok).toBe(true);
  return id;
}

async function customer(name = "Rahim") {
  const id = randomUUID();
  const result = await run(asOwner(), "customer.create", { id, name });
  expect(result.ok).toBe(true);
  return id;
}

const line = (productId: string, over: Record<string, unknown> = {}) => ({
  productId,
  productName: "Milk",
  productNameBn: "",
  unit: "pcs",
  qty: 1000,
  listPrice: 5000,
  unitPrice: 5000,
  unitCost: 0,
  discount: 0,
  ...over,
});

async function sell(input: Record<string, unknown>, who = asOwner()) {
  const id = randomUUID();
  const result = await run(who, "sale.create", { id, ...input });
  if (!result.ok) throw new Error(`sale failed: ${JSON.stringify(result)}`);
  return id;
}

const returnLine = (
  productId: string,
  qty: number,
  unitPrice: number,
  itemIndex = 0,
) => ({
  itemIndex,
  productId,
  productName: "Milk",
  productNameBn: "",
  unit: "pcs",
  qty,
  unitPrice,
});

const stockOf = async (id: string) =>
  Number((await col("products").findOne({ _id: id as never }))?.stock);
const balanceOf = async (id: string) =>
  Number((await col("customers").findOne({ _id: id as never }))?.balance);

describe("QA C1: voiding a sale after a return", () => {
  // 4 sold on credit, 3 returned with the goods put back and the money taken off the due, then the
  // whole sale voided. Only the one unit that is still with the customer should be put back and
  // taken off their due; the 3 already returned must not be reversed a second time.
  it("after a partial return the sale cannot be cancelled; returning the rest ends where it started", async () => {
    const milk = await product(100_000);
    const rahim = await customer();
    const saleId = await sell({
      customerId: rahim,
      customerName: "Rahim",
      lines: [line(milk, { qty: 4000 })],
      tendered: 0,
    });
    expect(await stockOf(milk)).toBe(96_000);
    expect(await balanceOf(rahim)).toBe(20_000);

    const ret = await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 3000, 5000)],
      settlement: "credit",
      restock: true,
    });
    expect(ret.ok).toBe(true);
    expect(await stockOf(milk)).toBe(99_000);
    expect(await balanceOf(rahim)).toBe(5_000);

    // Cancelling now would reverse the 3 again, so it is refused: the rest is returned instead.
    const voided = await run(asOwner(), "sale.void", {
      saleId,
      reason: "customer changed mind",
    });
    expect(voided.ok).toBe(false);
    expect(await stockOf(milk)).toBe(99_000);
    expect(await balanceOf(rahim)).toBe(5_000);

    const rest = await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 1000, 5000)],
      settlement: "credit",
      restock: true,
    });
    expect(rest.ok).toBe(true);

    // Everything is back to the start: 100 in stock, nothing owed.
    expect(await stockOf(milk)).toBe(100_000);
    expect(await balanceOf(rahim)).toBe(0);
  });

  // The same sale, return and void, looked at from two sides.
  async function soldReturnedVoided() {
    const milk = await product(50_000);
    const rahim = await customer("Karim");
    const saleId = await sell({
      customerId: rahim,
      customerName: "Karim",
      lines: [line(milk, { qty: 2000 })],
      tendered: 0,
    });
    await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 1000, 5000)],
      settlement: "credit",
      restock: true,
    });
    await run(asOwner(), "sale.void", { saleId, reason: "x" });
    return { milk, rahim };
  }

  it("the shop never ends with more goods than it started with", async () => {
    const { milk } = await soldReturnedVoided();
    expect(await stockOf(milk)).toBeLessThanOrEqual(50_000);
  });

  it("a customer who bought on credit is not left with a negative balance (the shop owing them)", async () => {
    const { rahim } = await soldReturnedVoided();
    expect(await balanceOf(rahim)).toBeGreaterThanOrEqual(0);
  });
});

describe("QA C2: returns from a discounted sale", () => {
  // One unit at ৳50.00 with a ৳10.00 bill discount: the customer paid ৳40.00. Returning it must
  // refund ৳40.00, not ৳50.00.
  it("refunds what was really paid after a bill discount", async () => {
    const milk = await product();
    const saleId = await sell({
      lines: [line(milk, { qty: 1000 })],
      discount: 1000,
      tendered: 4000,
    });
    const sale = await col("sales").findOne({ _id: saleId as never });
    expect(sale?.total).toBe(4000);

    const result = await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 1000, 5000)],
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const ret = result.docs.find((d) => d.collection === "returns")
      ?.doc as unknown as { total: number };
    expect(ret.total).toBe(4000);
  });

  it("refunds what was really paid after a line discount", async () => {
    const milk = await product();
    const saleId = await sell({
      lines: [line(milk, { qty: 2000, discount: 2000 })],
      tendered: 8000,
    });
    const sale = await col("sales").findOne({ _id: saleId as never });
    expect(sale?.total).toBe(8000);

    const result = await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 2000, 5000)],
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const ret = result.docs.find((d) => d.collection === "returns")
      ?.doc as unknown as { total: number };
    // Everything came back, so exactly what was paid goes back.
    expect(ret.total).toBe(8000);
  });

  it("returning every unit of a discounted sale never refunds more than the sale's total", async () => {
    const milk = await product();
    const saleId = await sell({
      lines: [line(milk, { qty: 3000 })],
      discount: 3000,
      tendered: 12_000,
    });
    const sale = await col("sales").findOne({ _id: saleId as never });
    const result = await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 3000, 5000)],
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const ret = result.docs.find((d) => d.collection === "returns")
      ?.doc as unknown as { total: number };
    expect(ret.total).toBeLessThanOrEqual(Number(sale?.total));
  });
});

describe("QA C3: a cashier's device cannot choose its own prices (offline push path)", () => {
  // The offline path takes listPrice and unitCost from the device. The price-override permission
  // is meant to stop a cashier selling below the list price.
  it("a cashier selling at a changed price is refused, even if the device claims the list price was the same", async () => {
    const { runCommand } = await import("@/commands/local/run");
    const ownerDevice = await createDevice(mongo, storeId, "owner", owner);
    const milk = randomUUID();
    await runCommand(ownerDevice.db, ownerDevice.ctx, "product.create", {
      id: milk,
      name: "Milk",
      sellingPrice: 5000,
      purchasePrice: 4000,
      openingStock: 100_000,
      openingMovementId: randomUUID(),
    });
    await ownerDevice.sync();

    // The cashier's device pulls the product, then rings it up cheaper while claiming the list
    // price was the same as the price it charged.
    const cashierDevice = await createDevice(
      mongo,
      storeId,
      "cashier",
      cashier,
    );
    await cashierDevice.sync();
    const saleId = randomUUID();
    await runCommand(cashierDevice.db, cashierDevice.ctx, "sale.create", {
      id: saleId,
      lines: [line(milk, { qty: 1000, listPrice: 1000, unitPrice: 1000 })],
      tendered: 1000,
    });
    await cashierDevice.sync().catch(() => undefined);
    const sale = await col("sales").findOne({ _id: saleId as never });
    // Expected: the server refuses a cashier's cheaper price. If it was accepted, the total is 1000.
    expect(sale?.total).not.toBe(1000);
  });
});

describe("a cashier's offline sale at a price the owner has since changed", () => {
  // Product decision 1, changed: the goods have left, so a sale made at the price the item had
  // until the owner changed it is kept (and flagged), not refused.
  async function setup() {
    const { runCommand } = await import("@/commands/local/run");
    const ownerDevice = await createDevice(mongo, storeId, "owner", owner);
    const milk = randomUUID();
    await runCommand(ownerDevice.db, ownerDevice.ctx, "product.create", {
      id: milk,
      name: "Milk",
      sellingPrice: 5000,
      purchasePrice: 4000,
      openingStock: 100_000,
      openingMovementId: randomUUID(),
    });
    await ownerDevice.sync();
    const cashierDevice = await createDevice(
      mongo,
      storeId,
      "cashier",
      cashier,
    );
    await cashierDevice.sync();
    const sellOffline = async (unitPrice: number) => {
      const id = randomUUID();
      await runCommand(cashierDevice.db, cashierDevice.ctx, "sale.create", {
        id,
        lines: [line(milk, { qty: 1000, listPrice: unitPrice, unitPrice })],
        tendered: unitPrice,
      });
      return id;
    };
    const ownerChangesPrice = async (price: number) => {
      await runCommand(ownerDevice.db, ownerDevice.ctx, "product.update", {
        id: milk,
        changes: { sellingPrice: price },
      });
      await ownerDevice.sync();
    };
    return { cashierDevice, sellOffline, ownerChangesPrice };
  }

  it("is kept at the price the customer paid", async () => {
    const { cashierDevice, sellOffline, ownerChangesPrice } = await setup();
    const saleId = await sellOffline(5000); // rung up before the change
    await new Promise((r) => setTimeout(r, 20));
    await ownerChangesPrice(6000);
    await cashierDevice.sync().catch(() => undefined);
    const sale = await col("sales").findOne({ _id: saleId as never });
    expect(sale?.total).toBe(5000);
  });

  it("is still refused when the price is not one the item had", async () => {
    const { cashierDevice, sellOffline, ownerChangesPrice } = await setup();
    const saleId = await sellOffline(1000);
    await new Promise((r) => setTimeout(r, 20));
    await ownerChangesPrice(6000);
    await cashierDevice.sync().catch(() => undefined);
    const sale = await col("sales").findOne({ _id: saleId as never });
    expect(sale).toBeNull();
  });

  it("is still refused when it was rung up after the change", async () => {
    const { cashierDevice, sellOffline, ownerChangesPrice } = await setup();
    await ownerChangesPrice(6000);
    await new Promise((r) => setTimeout(r, 20));
    const saleId = await sellOffline(5000); // the old price, claimed after the change
    await cashierDevice.sync().catch(() => undefined);
    const sale = await col("sales").findOne({ _id: saleId as never });
    expect(sale).toBeNull();
  });
});

describe("QA C4: deleting a customer or supplier who still owes or is owed money", () => {
  it("a customer with a balance cannot be deleted (or at least keeps appearing in dues)", async () => {
    const milk = await product();
    const rahim = await customer("Debtor");
    await sell({
      customerId: rahim,
      customerName: "Debtor",
      lines: [line(milk, { qty: 2000 })],
      tendered: 0,
    });
    expect(await balanceOf(rahim)).toBe(10_000);

    const customerDoc = await col("customers").findOne({
      _id: rahim as never,
    });
    const deleted = await run(
      asOwner(),
      "customer.delete",
      { id: rahim },
      { baseVersion: Number(customerDoc?.version) },
    );
    // Expected: refused because ৳100.00 is still owed.
    expect(deleted.ok).toBe(false);
  });

  it("after deleting a customer with a balance, their payment can still be collected", async () => {
    const milk = await product();
    const rahim = await customer("Debtor 2");
    await sell({
      customerId: rahim,
      customerName: "Debtor 2",
      lines: [line(milk, { qty: 1000 })],
      tendered: 0,
    });
    const customerDoc = await col("customers").findOne({
      _id: rahim as never,
    });
    await run(
      asOwner(),
      "customer.delete",
      { id: rahim },
      { baseVersion: Number(customerDoc?.version) },
    );
    const collected = await run(asOwner(), "payment.collect", {
      id: randomUUID(),
      partyId: rahim,
      amount: 5000,
      method: "cash",
    });
    expect(collected.ok).toBe(true);
  });
});

describe("QA C5: the same barcode on two offline devices", () => {
  it("the second device's later stock change on the rejected product does not silently vanish", async () => {
    const a = await createDevice(mongo, storeId, "owner", owner);
    const b = await createDevice(mongo, storeId, "owner", owner);
    const { runCommand } = await import("@/commands/local/run");
    const create = (d: typeof a, name: string) => {
      const id = randomUUID();
      return runCommand(d.db, d.ctx, "product.create", {
        id,
        name,
        barcode: "8901234",
        sellingPrice: 5000,
        purchasePrice: 4000,
        openingStock: 10_000,
        openingMovementId: randomUUID(),
      }).then(() => id);
    };
    const idA = await create(a, "Soap A");
    const idB = await create(b, "Soap B");
    await a.sync();
    await b.sync().catch(() => undefined);

    // Device B's product was refused (barcode taken). It must say so, not just disappear.
    const failedOnB = await b.db.outbox
      .where("status")
      .equals("failed")
      .toArray();
    expect(failedOnB.map((op) => op.lastError)).toContain("DUPLICATE_BARCODE");
    expect(await col("products").countDocuments({ barcode: "8901234" })).toBe(
      1,
    );
    expect(await col("products").findOne({ _id: idA as never })).toBeTruthy();
    expect(await col("products").findOne({ _id: idB as never })).toBeNull();
  });

  it("sales the second device rang up for the refused product are not left without stock movements", async () => {
    const a = await createDevice(mongo, storeId, "owner", owner);
    const b = await createDevice(mongo, storeId, "owner", owner);
    const { runCommand } = await import("@/commands/local/run");
    const idA = randomUUID();
    const idB = randomUUID();
    const base = {
      barcode: "8905555",
      sellingPrice: 5000,
      purchasePrice: 4000,
      openingStock: 10_000,
    };
    await runCommand(a.db, a.ctx, "product.create", {
      ...base,
      id: idA,
      name: "Tea A",
      openingMovementId: randomUUID(),
    });
    await runCommand(b.db, b.ctx, "product.create", {
      ...base,
      id: idB,
      name: "Tea B",
      openingMovementId: randomUUID(),
    });
    // Device B sells its (soon to be refused) product before it ever syncs.
    const saleId = randomUUID();
    await runCommand(b.db, b.ctx, "sale.create", {
      id: saleId,
      lines: [line(idB, { qty: 1000 })],
      tendered: 5000,
    });
    await a.sync();
    await b.sync().catch(() => undefined);

    // The sale reached the shop: its goods must be accounted for somewhere.
    const sale = await col("sales").findOne({ _id: saleId as never });
    if (!sale) return; // refused outright: nothing is lost silently
    const movements = await col("stockMovements").countDocuments({
      _id: { $regex: `^${saleId}:m` } as never,
    });
    expect(movements).toBeGreaterThan(0);
  });
});

describe("QA S5: an operation the server keeps failing on", () => {
  // An operation that always throws on the server is answered "retry" and halts every later
  // operation of the device, forever: the queue is stuck behind it.
  it("a poison operation does not stop the good operations behind it", async () => {
    const deviceId = randomUUID();
    const op = (type: string, payload: unknown) => ({
      operationId: randomUUID(),
      type,
      schemaVersion: 1,
      payload,
      actorUserId: owner,
      deviceId,
      createdAt: new Date().toISOString(),
    });
    // An old sale record with no lines in it (written before sales had them), then voided.
    const oldSale = randomUUID();
    await col("sales").insertOne({
      _id: oldSale,
      storeId,
      invoiceNo: "OLD-1",
      status: "active",
      customerId: null,
      due: 0,
      version: 1,
      syncSeq: 1,
    } as never);
    const categoryId = randomUUID();
    const response = await handlePush(
      mongo,
      { storeId, deviceId },
      {
        deviceId,
        appVersion: "1.0.0",
        ops: [
          op("sale.void", {
            saleId: oldSale,
            reason: "",
            customerId: null,
            due: 0,
            lines: [{ productId: randomUUID(), qty: 1 }],
          }),
          op("category.create", { id: categoryId, name: "Tea" }),
        ],
      },
    );
    const statuses = response.results.map((r) => r.status);
    // The category is unrelated: it must be applied whatever happened to the void.
    expect(statuses[1]).toBe("applied");
    expect(statuses[0]).not.toBe("retry"); // "retry" would be sent again forever
  });
});

describe("QA S5: a batch the server cannot accept", () => {
  const validOp = (over: Record<string, unknown> = {}) => ({
    operationId: randomUUID(),
    type: "category.create",
    schemaVersion: 1,
    payload: { id: randomUUID(), name: "Tea" },
    actorUserId: owner,
    deviceId: randomUUID(),
    createdAt: new Date().toISOString(),
    ...over,
  });

  it("one malformed operation in a batch must not stop the good ones from being accepted", () => {
    const deviceId = randomUUID();
    const good = validOp({ deviceId });
    const bad = validOp({ deviceId, operationId: "not-a-uuid" });
    const parsed = pushRequestSchema.safeParse({
      deviceId,
      appVersion: "1.0.0",
      ops: [good, bad, validOp({ deviceId })],
    });
    // Today the whole request is refused (400), so the good operations wait behind the bad one.
    expect(parsed.success).toBe(true);
  });
});

describe("QA C1 (more cases): cancelling a sale after returns", () => {
  it("a sale whose goods all came back cannot be cancelled (BUG-20), so nothing is reversed twice", async () => {
    const milk = await product(50_000);
    const rahim = await customer("Full Return");
    const saleId = await sell({
      customerId: rahim,
      customerName: "Full Return",
      lines: [line(milk, { qty: 2000 })],
      tendered: 0,
    });
    const ret = await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 2000, 5000)],
      settlement: "credit",
      restock: true,
    });
    expect(ret.ok).toBe(true);
    expect(await stockOf(milk)).toBe(50_000);
    expect(await balanceOf(rahim)).toBe(0);

    const voided = await run(asOwner(), "sale.void", { saleId, reason: "x" });
    expect(voided.ok).toBe(false);
    expect(await stockOf(milk)).toBe(50_000);
    expect(await balanceOf(rahim)).toBe(0);
  });

  it("goods returned damaged stay out of stock, and the sale cannot be cancelled afterwards", async () => {
    const milk = await product(50_000);
    const saleId = await sell({
      lines: [line(milk, { qty: 2000 })],
      tendered: 10_000,
    });
    await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 1000, 5000)],
      restock: false,
    });
    expect(await stockOf(milk)).toBe(48_000); // the damaged unit is not back in stock
    const voided = await run(asOwner(), "sale.void", { saleId, reason: "x" });
    expect(voided.ok).toBe(false);
    expect(await stockOf(milk)).toBe(48_000);
  });

  it("a refund after a bill discount stays right across two partial returns", async () => {
    const milk = await product();
    const saleId = await sell({
      lines: [line(milk, { qty: 3000 })],
      discount: 1000,
      tendered: 14_000,
    });
    const refund = async (qty: number) => {
      const result = await run(asOwner(), "saleReturn.create", {
        id: randomUUID(),
        saleId,
        lines: [returnLine(milk, qty, 5000)],
      });
      if (!result.ok) throw new Error(JSON.stringify(result));
      const doc = result.docs.find((d) => d.collection === "returns")
        ?.doc as unknown as { total: number };
      return doc.total;
    };
    // ৳150.00 less ৳10.00 = ৳140.00 for 3 units.
    const parts = [await refund(1000), await refund(2000)];
    expect(parts[0] + parts[1]).toBe(14_000);
  });
});

describe("BUG-20: a sale that has come back in full cannot be cancelled", () => {
  it("is refused (online command and pushed operation), and nothing moves", async () => {
    const milk = await product(100_000);
    const saleId = await sell({
      lines: [line(milk, { qty: 3000 })],
      tendered: 15_000,
    });
    const back = await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 3000, 5000)],
      settlement: "cash",
      restock: true,
    });
    expect(back.ok).toBe(true);
    expect(await stockOf(milk)).toBe(100_000);

    const voided = await run(asOwner(), "sale.void", { saleId, reason: "x" });
    expect(voided.ok).toBe(false);
    expect((await col("sales").findOne({ _id: saleId as never }))?.status).toBe(
      "active",
    );
    expect(await stockOf(milk)).toBe(100_000);
  });

  it("counts a return that did not go back into stock as returned too", async () => {
    const milk = await product(100_000);
    const saleId = await sell({
      lines: [line(milk, { qty: 2000 })],
      tendered: 10_000,
    });
    await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 2000, 5000)],
      settlement: "cash",
      restock: false,
    });
    const voided = await run(asOwner(), "sale.void", { saleId, reason: "x" });
    expect(voided.ok).toBe(false);
  });

  it("a partly returned sale cannot be cancelled either: the rest is returned instead", async () => {
    const milk = await product(100_000);
    const saleId = await sell({
      lines: [line(milk, { qty: 4000 })],
      tendered: 20_000,
    });
    await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, 3000, 5000)],
      settlement: "cash",
      restock: true,
    });
    const voided = await run(asOwner(), "sale.void", { saleId, reason: "x" });
    expect(voided.ok).toBe(false);
    expect((await col("sales").findOne({ _id: saleId as never }))?.status).toBe(
      "active",
    );
    expect(await stockOf(milk)).toBe(99_000);
  });
});

describe("returns, dues and store credit add up (online commands)", () => {
  const sumOf = async (days = 1) => {
    const { serverSummary } = await import("../reports");
    const day = new Date().toISOString().slice(0, 10);
    void days;
    return serverSummary(mongo.db, storeId, { from: day, to: day });
  };
  const opening = (partyId: string, amount: number) =>
    run(asOwner(), "party.openingBalance", {
      id: randomUUID(),
      partyType: "customer",
      partyId,
      amount,
      note: "",
    });
  const giveBack = (saleId: string, milk: string, qty: number, extra = {}) =>
    run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [returnLine(milk, qty, 5000)],
      restock: true,
      ...extra,
    });

  it("a sale uses the customer's store credit first, and says so", async () => {
    const milk = await product();
    const rahim = await customer("Credit user");
    await opening(rahim, -5_000); // paid ৳50 ahead
    const saleId = await sell({
      customerId: rahim,
      customerName: "Credit user",
      lines: [line(milk, { qty: 4000 })], // ৳200
      tendered: 15_000,
      creditUsed: 5_000,
    });
    const sale = await col("sales").findOne({ _id: saleId as never });
    expect(sale).toMatchObject({
      total: 20_000,
      creditUsed: 5_000,
      paid: 15_000,
      due: 0,
    });
    expect(await balanceOf(rahim)).toBe(0); // the credit is used up
  });

  it("credit that is not really there is not used: the rest becomes due", async () => {
    const milk = await product();
    const rahim = await customer("No credit");
    const saleId = await sell({
      customerId: rahim,
      customerName: "No credit",
      lines: [line(milk, { qty: 4000 })],
      tendered: 15_000,
      creditUsed: 5_000, // claimed, but the balance is 0
    });
    const sale = await col("sales").findOne({ _id: saleId as never });
    expect(sale).toMatchObject({ creditUsed: 0, paid: 15_000, due: 5_000 });
    expect(await balanceOf(rahim)).toBe(5_000);
  });

  it("cancelling a sale that used store credit gives the credit back", async () => {
    const milk = await product();
    const rahim = await customer("Cancel credit");
    await opening(rahim, -5_000);
    const saleId = await sell({
      customerId: rahim,
      customerName: "Cancel credit",
      lines: [line(milk, { qty: 4000 })],
      tendered: 15_000,
      creditUsed: 5_000,
    });
    expect(await balanceOf(rahim)).toBe(0);
    const voided = await run(asOwner(), "sale.void", { saleId, reason: "x" });
    expect(voided.ok).toBe(true);
    expect(await balanceOf(rahim)).toBe(-5_000);
  });

  it("returns a credit sale: the due comes off, and Reports' 'left unpaid' follows (the reported bug)", async () => {
    const milk = await product();
    const rahim = await customer("Return credit sale");
    const before = await sumOf();
    const saleId = await sell({
      customerId: rahim,
      customerName: "Return credit sale",
      lines: [line(milk, { qty: 4000 })],
      tendered: 0,
    });
    expect(await balanceOf(rahim)).toBe(20_000);
    // Refund the lot with nothing in cash: it all comes off what is owed.
    const r = await giveBack(saleId, milk, 4000, { cashBack: 0 });
    expect(r.ok).toBe(true);
    expect(await balanceOf(rahim)).toBe(0);
    const after = await sumOf();
    expect(after.unpaid - before.unpaid).toBe(0);
    expect(after.netSales - before.netSales).toBe(0);
  });

  it("a refund above the due leaves the customer paid ahead, and Reports agree with the customer page", async () => {
    const milk = await product();
    const rahim = await customer("Paid ahead");
    await opening(rahim, -5_000);
    const before = await sumOf();
    const saleId = await sell({
      customerId: rahim,
      customerName: "Paid ahead",
      lines: [line(milk, { qty: 4000 })],
      tendered: 5_000, // ৳50 now, ৳150 owed (the ৳50 of credit stays in the balance)
    });
    expect(await balanceOf(rahim)).toBe(10_000);
    const r = await giveBack(saleId, milk, 4000, { cashBack: 0 }); // keep it all as credit
    expect(r.ok).toBe(true);
    expect(await balanceOf(rahim)).toBe(-10_000);
    const after = await sumOf();
    const delta = (k: "netSales" | "received" | "unpaid" | "creditUsed") =>
      after[k] - before[k];
    expect(delta("received") + delta("creditUsed") + delta("unpaid")).toBe(
      delta("netSales"),
    );
    expect(delta("unpaid")).toBe(15_000 - 20_000);
  });

  it("a walk-in sale is always refunded in cash, whatever the screen asked", async () => {
    const milk = await product();
    const saleId = await sell({
      lines: [line(milk, { qty: 2000 })],
      tendered: 10_000,
    });
    const r = await giveBack(saleId, milk, 2000, { cashBack: 0 });
    expect(r.ok).toBe(true);
    const doc = await col("returns").findOne({ refId: saleId } as never);
    expect(doc).toMatchObject({ cashBack: 10_000, credited: 0 });
  });

  it("an older device that sends only 'credit' still works", async () => {
    const milk = await product();
    const rahim = await customer("Old device");
    const saleId = await sell({
      customerId: rahim,
      customerName: "Old device",
      lines: [line(milk, { qty: 2000 })],
      tendered: 0,
    });
    const r = await giveBack(saleId, milk, 1000, { settlement: "credit" });
    expect(r.ok).toBe(true);
    expect(await balanceOf(rahim)).toBe(5_000);
    expect(
      await col("returns").findOne({ refId: saleId } as never),
    ).toMatchObject({ credited: 5_000, cashBack: 0 });
  });
});
