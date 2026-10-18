import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PermissionError } from "@/commands/errors";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { loadCash, loadMoney } from "@/reports/cash-local";
import { dayKey } from "@/reports/compute";
import { serverCash, serverMoney } from "@/server/cash";
import { createDevice, type Device } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";

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

const owner = () => createDevice(mongo, storeId, "owner", ownerId);

/** A shop of its own, so a test about who may set the day starts with the day not set. */
async function freshShop() {
  const id = await mongo.seedStore();
  const ownerUser = await mongo.seedUser(id, "owner");
  const managerUser = await mongo.seedUser(id, "manager");
  const cashierUser = await mongo.seedUser(id, "cashier");
  return {
    storeId: id,
    cashierId: cashierUser,
    owner: () => createDevice(mongo, id, "owner", ownerUser),
    manager: () => createDevice(mongo, id, "manager", managerUser),
  };
}

async function addProduct(d: Device) {
  const id = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id,
    name: "Fresh Milk",
    nameBn: "",
    sellingPrice: 5000,
    purchasePrice: 4000,
    openingStock: 100_000,
    openingMovementId: newId(),
  });
  return id;
}
const sLine = (productId: string, qty: number) => ({
  productId,
  productName: "Fresh Milk",
  productNameBn: "",
  unit: "pcs" as const,
  qty,
  listPrice: 5000,
  unitPrice: 5000,
  unitCost: 4000,
  discount: 0,
});
const setDrawer = (d: Device, amount: number, day = today()) =>
  runCommand(d.db, d.ctx, "drawer.set", {
    id: newId(),
    day,
    amount,
    byName: "রহিম",
  });

describe("the cash drawer", () => {
  it("expected cash = opening + cash in − cash out, the same on the device and on the server", async () => {
    const d = await owner();
    const milk = await addProduct(d);
    await setDrawer(d, 50_000); // ৳500 in the drawer at opening

    // Cash in: a ৳100 cash sale (the change handed back is not counted), a ৳30 due collected.
    const cashSale = newId();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: cashSale,
      lines: [sLine(milk, 2000)],
      tendered: 20_000,
    });
    // Not cash: a ৳80 bKash sale does not touch the drawer.
    await runCommand(d.db, d.ctx, "sale.create", {
      id: newId(),
      lines: [sLine(milk, 1600)],
      tendered: 8_000,
      paymentMethod: "bkash",
    });
    const customer = newId();
    await runCommand(d.db, d.ctx, "customer.create", {
      id: customer,
      name: "রহিম",
    });
    await runCommand(d.db, d.ctx, "payment.collect", {
      id: newId(),
      partyId: customer,
      amount: 3_000,
    });
    // A ৳5 payment that is cancelled the same day: nets to nothing.
    const mistake = newId();
    await runCommand(d.db, d.ctx, "payment.collect", {
      id: mistake,
      partyId: customer,
      amount: 500,
    });
    await runCommand(d.db, d.ctx, "payment.void", {
      id: mistake,
      reason: "wrong",
    });

    // Cash out: a ৳20 expense, a ৳45 purchase paid in cash, ৳10 paid to a supplier, ৳50 refunded.
    await runCommand(d.db, d.ctx, "expense.create", {
      id: newId(),
      category: "other",
      amount: 2_000,
      date: today(),
    });
    const supplier = newId();
    await runCommand(d.db, d.ctx, "supplier.create", {
      id: supplier,
      name: "করিম",
    });
    await runCommand(d.db, d.ctx, "purchase.create", {
      id: newId(),
      supplierId: supplier,
      supplierName: "করিম",
      date: today(),
      lines: [
        {
          productId: milk,
          productName: "Fresh Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 1000,
          unitCost: 4500,
          discount: 0,
        },
      ],
      paid: 4_500,
    });
    await runCommand(d.db, d.ctx, "payment.pay", {
      id: newId(),
      partyId: supplier,
      amount: 1_000,
    });
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId: cashSale,
      lines: [
        {
          itemIndex: 0,
          productId: milk,
          productName: "Fresh Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 1000,
          unitPrice: 5000,
        },
      ],
    });

    const device = await loadCash(d.db, today(), TZ);
    expect(device.opening).toBe(50_000);
    expect(device.flow).toMatchObject({
      sales: 10_000,
      customerPayments: 3_000,
      supplierRefunds: 0,
      customerRefunds: 5_000,
      purchases: 4_500,
      supplierPayments: 1_000,
      expenses: 2_000,
    });
    // 500 + 100 + 30 − 20 − 45 − 10 − 50 = 505
    expect(device.expected).toBe(50_500);

    await d.sync();
    const server = await serverCash(mongo.db, storeId, today(), TZ);
    expect(server).toEqual(device);
  });

  it("a day with no opening counts from zero and says so", async () => {
    const d = await owner();
    const none = await loadCash(d.db, "2020-01-01", TZ);
    expect(none.opening).toBeNull();
    expect(none.expected).toBe(0);
  });

  it("a manager sets the day once; only the owner corrects it, and the log keeps every entry", async () => {
    const shop = await freshShop();
    const m = await shop.manager();
    const o = await shop.owner();
    const yesterday = dayKey(Date.now() - 86_400_000, TZ);
    await setDrawer(o, 7_000, yesterday); // the owner may set any day
    await setDrawer(m, 20_000); // the manager opens today
    // The manager cannot set it again (on the device)...
    await expect(setDrawer(m, 99_000)).rejects.toThrow(/DRAWER_ALREADY_SET/);
    // ...and the owner can (a correction).
    await m.sync();
    await o.sync();
    await setDrawer(o, 25_000);
    await o.sync();

    const report = await serverCash(mongo.db, shop.storeId, today(), TZ);
    expect(report.opening).toBe(25_000);
    expect(report.entries.map((e) => [e.kind, e.amount])).toEqual([
      ["open", 20_000],
      ["correct", 25_000],
    ]);
    // Earlier days show up in the history with the figure they ended with.
    expect(report.history).toEqual([
      { day: yesterday, opening: 7_000, entries: 1 },
    ]);
  });

  it("two managers opening the same day offline: the server keeps the first and refuses the second", async () => {
    const shop = await freshShop();
    const a = await shop.manager();
    const b = await shop.manager();
    a.faults.offline = true;
    b.faults.offline = true;
    await setDrawer(a, 11_000);
    await setDrawer(b, 22_000);
    a.faults.offline = false;
    b.faults.offline = false;
    await a.sync();
    await b.sync();
    const failed = await b.db.outbox.where("status").equals("failed").toArray();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      type: "drawer.set",
      lastError: "DRAWER_ALREADY_SET",
    });
    expect(
      (await serverCash(mongo.db, shop.storeId, today(), TZ)).opening,
    ).toBe(11_000);
  });

  it("a cashier cannot set the drawer, and a manager cannot set another day", async () => {
    const shop = await freshShop();
    const c = await createDevice(
      mongo,
      shop.storeId,
      "cashier",
      shop.cashierId,
    );
    await expect(setDrawer(c, 1_000)).rejects.toBeInstanceOf(PermissionError);

    const m = await shop.manager();
    await setDrawer(m, 5_000, "2026-09-01"); // a past day: the device allows it...
    await m.sync(); // ...the server does not (only the owner sets other days)
    const failed = await m.db.outbox.where("status").equals("failed").toArray();
    expect(failed[0]).toMatchObject({
      type: "drawer.set",
      lastError: "FORBIDDEN",
    });
  });
});

describe("money in and out, by payment method", () => {
  it("the device and the server give the same figures, with a refund counted under its bill's method", async () => {
    const shop = await freshShop();
    const d = await shop.owner();
    const milk = await addProduct(d);

    // Cash ৳100 and bKash ৳80 sales; ৳50 of the bKash one is refunded.
    await runCommand(d.db, d.ctx, "sale.create", {
      id: newId(),
      lines: [sLine(milk, 2000)],
      tendered: 20_000,
    });
    const bkashSale = newId();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: bkashSale,
      lines: [sLine(milk, 1600)],
      tendered: 8_000,
      paymentMethod: "bkash",
    });
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId: bkashSale,
      lines: [
        {
          itemIndex: 0,
          productId: milk,
          productName: "Fresh Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 1000,
          unitPrice: 5000,
        },
      ],
    });
    // ৳30 of a due collected in Nagad, ৳20 expense through the bank.
    const customer = newId();
    await runCommand(d.db, d.ctx, "customer.create", {
      id: customer,
      name: "রহিম",
    });
    await runCommand(d.db, d.ctx, "payment.collect", {
      id: newId(),
      partyId: customer,
      amount: 3_000,
      method: "nagad",
    });
    await runCommand(d.db, d.ctx, "expense.create", {
      id: newId(),
      category: "other",
      amount: 2_000,
      date: today(),
      method: "bank",
    });

    const range = { from: today(), to: today() };
    const device = await loadMoney(d.db, range, TZ);
    expect(device.methods.cash).toMatchObject({ totalIn: 10_000, totalOut: 0 });
    expect(device.methods.bkash).toMatchObject({
      sales: 8_000,
      customerRefunds: 5_000,
      totalIn: 8_000,
      totalOut: 5_000,
    });
    expect(device.methods.nagad.totalIn).toBe(3_000);
    expect(device.methods.bank.totalOut).toBe(2_000);
    expect(device.all).toMatchObject({ totalIn: 21_000, totalOut: 7_000 });
    // The drawer's cash line is the cash column, and the bKash refund is not taken from it.
    expect((await loadCash(d.db, today(), TZ)).flow).toEqual(
      device.methods.cash,
    );

    await d.sync();
    expect(await serverMoney(mongo.db, shop.storeId, range, TZ)).toEqual(
      device,
    );
    // A wider range sees the same today.
    const wide = { from: dayKey(Date.now() - 3 * 86_400_000, TZ), to: today() };
    expect(await serverMoney(mongo.db, shop.storeId, wide, TZ)).toEqual(
      await loadMoney(d.db, wide, TZ),
    );
  });
});
