import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { loadMoney } from "@/reports/cash-local";
import { dayKey } from "@/reports/compute";
import { serverMoney } from "@/server/cash";
import { createDevice, type Device } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { pullAll } from "../engine";

/**
 * Cancelling a return and cancelling a purchase (or a sale's return), on the device and on the
 * server. The first test replays a real mistake: a purchase paid by bank was entered as cash, and
 * then returned in full to "undo" it, which also wiped the shop's old due to the supplier.
 */

let mongo: TestMongo;
let storeId: string;
let ownerId: string;
const TZ = "Asia/Dhaka";
const today = () => dayKey(Date.now(), TZ);

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  ownerId = await mongo.seedUser(storeId, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const newDevice = () => createDevice(mongo, storeId, "owner", ownerId);
const server = (collection: string, id: string) =>
  mongo.db.collection(collection).findOne({ _id: id as never });

async function product(d: Device, name: string, stock: number) {
  const id = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id,
    name,
    nameBn: "",
    sellingPrice: 150_000,
    purchasePrice: 131_300,
    openingStock: stock,
    openingMovementId: newId(),
  });
  return id;
}

async function supplierOwed(d: Device, owed: number) {
  const id = newId();
  await runCommand(d.db, d.ctx, "supplier.create", { id, name: "ভরসা" });
  if (owed)
    await runCommand(d.db, d.ctx, "party.openingBalance", {
      id: newId(),
      partyType: "supplier",
      partyId: id,
      amount: owed,
      note: "আগের হিসাব",
    });
  return id;
}

const line = (productId: string, qty: number, unitCost: number) => ({
  productId,
  productName: "ভরসা গাভী",
  productNameBn: "",
  unit: "pcs" as const,
  qty,
  unitCost,
  discount: 0,
});

describe("cancelling a wrong purchase that was 'undone' with a return", () => {
  it("cancel the return, then the purchase: stock, the supplier's due and the money are as before", async () => {
    const d = await newDevice();
    const cow = await product(d, "ভরসা গাভী", 25_000);
    const fat = await product(d, "ভরসা ফ্যাটেনিং", 0);
    const supplier = await supplierOwed(d, 1_400_000); // the shop owes ৳14,000

    // ৳43,402 bought, all paid, entered as cash (it was bank).
    const purchaseId = newId();
    await runCommand(d.db, d.ctx, "purchase.create", {
      id: purchaseId,
      supplierId: supplier,
      supplierName: "ভরসা",
      date: today(),
      lines: [line(cow, 20_000, 131_300), line(fat, 10_000, 131_300)],
      paid: 3_939_000,
      paymentMethod: "cash",
    });
    // Returned in full: ৳14,000 off the due, the rest "back in cash".
    const returnId = newId();
    await runCommand(d.db, d.ctx, "purchaseReturn.create", {
      id: returnId,
      purchaseId,
      lines: [
        { ...line(cow, 20_000, 131_300), itemIndex: 0 },
        { ...line(fat, 10_000, 131_300), itemIndex: 1 },
      ],
      cashBack: 3_939_000 - 1_400_000,
    });
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(0);
    await d.sync();

    // The purchase cannot be cancelled while its return stands.
    await expect(
      runCommand(d.db, d.ctx, "purchase.void", { purchaseId, reason: "x" }),
    ).rejects.toThrow(/HAS_RETURNS/);

    // 1. Cancel the return: goods and the ৳14,000 due come back.
    await runCommand(d.db, d.ctx, "return.void", {
      id: returnId,
      reason: "ভুল ছিল",
    });
    expect((await d.db.returns.get(returnId))?.status).toBe("voided");
    expect((await d.db.products.get(cow))?.stock).toBe(45_000);
    expect((await d.db.products.get(fat))?.stock).toBe(10_000);
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(1_400_000);

    // 2. Cancel the purchase: its goods leave, nothing extra is owed.
    await runCommand(d.db, d.ctx, "purchase.void", {
      purchaseId,
      reason: "ভুল মাধ্যম",
    });
    expect((await d.db.purchases.get(purchaseId))?.status).toBe("voided");
    expect((await d.db.products.get(cow))?.stock).toBe(25_000);
    expect((await d.db.products.get(fat))?.stock).toBe(0);
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(1_400_000);

    // The day's money nets to nothing: paid, refunded, refund cancelled, purchase cancelled.
    const range = { from: today(), to: today() };
    const device = await loadMoney(d.db, range, TZ);
    expect(device.methods.cash.totalIn).toBe(device.methods.cash.totalOut);
    expect(device.methods.cash).toMatchObject({
      purchases: 0,
      supplierRefunds: 0,
    });

    // The server agrees, and a second phone sees the same.
    await d.sync();
    expect(await server("returns", returnId)).toMatchObject({
      status: "voided",
    });
    expect(await server("purchases", purchaseId)).toMatchObject({
      status: "voided",
    });
    expect((await server("suppliers", supplier))?.balance).toBe(1_400_000);
    expect((await server("products", cow))?.stock).toBe(25_000);
    expect((await server("products", fat))?.stock).toBe(0);
    expect(await serverMoney(mongo.db, storeId, range, TZ)).toEqual(device);

    const other = await newDevice();
    await pullAll(other.db, other.transport);
    expect((await other.db.suppliers.get(supplier))?.balance).toBe(1_400_000);
    expect((await other.db.products.get(cow))?.stock).toBe(25_000);
    expect((await other.db.returns.get(returnId))?.status).toBe("voided");

    // Cancelling again changes nothing.
    await expect(
      runCommand(d.db, d.ctx, "return.void", { id: returnId, reason: "x" }),
    ).rejects.toThrow();
    await expect(
      runCommand(d.db, d.ctx, "purchase.void", { purchaseId, reason: "x" }),
    ).rejects.toThrow();
    // And nothing can be returned against a cancelled purchase.
    await expect(
      runCommand(d.db, d.ctx, "purchaseReturn.create", {
        id: newId(),
        purchaseId,
        lines: [{ ...line(cow, 1_000, 131_300), itemIndex: 0 }],
      }),
    ).rejects.toThrow();
  });
});

describe("cancelling a purchase", () => {
  it("takes off what it put on the supplier's account and cancels the extra kept on their account", async () => {
    const d = await newDevice();
    const cow = await product(d, "ভরসা গাভী", 0);
    const supplier = await supplierOwed(d, 0);
    // ৳131.30 bought, ৳31.30 paid: ৳100 owed.
    const credit = newId();
    await runCommand(d.db, d.ctx, "purchase.create", {
      id: credit,
      supplierId: supplier,
      supplierName: "ভরসা",
      date: today(),
      lines: [line(cow, 1_000, 13_130)],
      paid: 3_130,
    });
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(10_000);
    // ৳131.30 bought, ৳200 paid, the extra ৳68.70 kept on their account (it clears the ৳100 owed
    // down to ৳31.30).
    const extra = newId();
    await runCommand(d.db, d.ctx, "purchase.create", {
      id: extra,
      supplierId: supplier,
      supplierName: "ভরসা",
      date: today(),
      lines: [line(cow, 1_000, 13_130)],
      paid: 20_000,
      toAccount: 6_870,
    });
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(3_130);

    // The kept-on-account payment cannot be cancelled on its own while the purchase stands.
    await expect(
      runCommand(d.db, d.ctx, "payment.void", {
        id: `${extra}:p`,
        reason: "x",
      }),
    ).rejects.toThrow(/LINKED_TO_PURCHASE/);

    await runCommand(d.db, d.ctx, "purchase.void", {
      purchaseId: extra,
      reason: "x",
    });
    expect((await d.db.payments.get(`${extra}:p`))?.status).toBe("voided");
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(10_000);
    await runCommand(d.db, d.ctx, "purchase.void", {
      purchaseId: credit,
      reason: "x",
    });
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(0);
    expect((await d.db.products.get(cow))?.stock).toBe(0);

    await d.sync();
    expect((await server("suppliers", supplier))?.balance).toBe(0);
    expect(await server("payments", `${extra}:p`)).toMatchObject({
      status: "voided",
    });
    expect((await server("products", cow))?.stock).toBe(0);
  });

  it("if the server refuses the cancellation, the device shows the purchase as it was", async () => {
    const d = await newDevice();
    const cow = await product(d, "ভরসা গাভী", 0);
    const supplier = await supplierOwed(d, 0);
    const id = newId();
    await runCommand(d.db, d.ctx, "purchase.create", {
      id,
      supplierId: supplier,
      supplierName: "ভরসা",
      date: today(),
      lines: [line(cow, 2_000, 131_300)],
      paid: 0,
    });
    await d.sync();
    // Another phone returned some of it (the server has a return this phone has not seen).
    await mongo.db.collection("returns").insertOne({
      _id: newId() as never,
      storeId,
      kind: "purchase",
      refId: id,
      lines: [{ itemIndex: 0, qty: 1_000 }],
      total: 131_300,
      createdAt: new Date().toISOString(),
    } as never);
    await runCommand(d.db, d.ctx, "purchase.void", {
      purchaseId: id,
      reason: "x",
    });
    expect((await d.db.products.get(cow))?.stock).toBe(0);
    await d.sync();
    const op = (await d.db.outbox.toArray()).find(
      (o) => o.type === "purchase.void",
    );
    expect(op).toMatchObject({ status: "failed", lastError: "HAS_RETURNS" });
    expect((await d.db.purchases.get(id))?.status).not.toBe("voided");
    expect((await d.db.products.get(cow))?.stock).toBe(2_000);
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(262_600);
  });
});

describe("cancelling a sale's return", () => {
  it("puts the customer's due and the stock back, and then the sale itself can be cancelled", async () => {
    const d = await newDevice();
    const milk = await product(d, "দুধ", 10_000);
    const customer = newId();
    await runCommand(d.db, d.ctx, "customer.create", {
      id: customer,
      name: "রহিম",
    });
    // ৳300 on credit (2 × ৳150), then 1 returned, taken off what they owe.
    const sale = newId();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: sale,
      customerId: customer,
      customerName: "রহিম",
      lines: [
        {
          productId: milk,
          productName: "দুধ",
          productNameBn: "",
          unit: "pcs",
          qty: 2_000,
          listPrice: 150_000,
          unitPrice: 150_000,
          unitCost: 131_300,
          discount: 0,
        },
      ],
      tendered: 0,
    });
    const ret = newId();
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: ret,
      saleId: sale,
      lines: [
        {
          itemIndex: 0,
          productId: milk,
          productName: "দুধ",
          productNameBn: "",
          unit: "pcs",
          qty: 1_000,
          unitPrice: 150_000,
        },
      ],
      cashBack: 0,
    });
    expect((await d.db.customers.get(customer))?.balance).toBe(150_000);
    expect((await d.db.products.get(milk))?.stock).toBe(9_000);
    await expect(
      runCommand(d.db, d.ctx, "sale.void", { saleId: sale, reason: "x" }),
    ).rejects.toThrow(/HAS_RETURNS/);

    await runCommand(d.db, d.ctx, "return.void", { id: ret, reason: "ভুল" });
    expect((await d.db.customers.get(customer))?.balance).toBe(300_000);
    expect((await d.db.products.get(milk))?.stock).toBe(8_000);

    await runCommand(d.db, d.ctx, "sale.void", { saleId: sale, reason: "x" });
    expect((await d.db.customers.get(customer))?.balance).toBe(0);
    expect((await d.db.products.get(milk))?.stock).toBe(10_000);

    await d.sync();
    expect((await server("customers", customer))?.balance).toBe(0);
    expect((await server("products", milk))?.stock).toBe(10_000);
    expect(await server("returns", ret)).toMatchObject({ status: "voided" });
  });
});
