import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
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
const pending = (d: Device) =>
  d.db.outbox.where("status").anyOf("pending", "syncing").count();
const stock = async (d: Device, id: string) =>
  (await d.db.products.get(id))?.stock;
const today = "2026-10-02";

async function addProduct(d: Device, stockQty = 10_000, cost = 4000) {
  const id = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id,
    name: "Fresh Milk",
    nameBn: "ফ্রেশ দুধ",
    sellingPrice: 5000,
    purchasePrice: cost,
    openingStock: stockQty,
    openingMovementId: newId(),
  });
  return id;
}
async function addSupplier(d: Device) {
  const id = newId();
  await runCommand(d.db, d.ctx, "supplier.create", {
    id,
    name: "করিম ট্রেডার্স",
    phone: "01811111111",
    contactPerson: "করিম",
  });
  return id;
}
async function addCustomer(d: Device) {
  const id = newId();
  await runCommand(d.db, d.ctx, "customer.create", { id, name: "রহিম" });
  return id;
}

const pLine = (productId: string, qty: number, unitCost = 4500) => ({
  productId,
  productName: "Fresh Milk",
  productNameBn: "ফ্রেশ দুধ",
  unit: "pcs" as const,
  qty,
  unitCost,
  discount: 0,
});
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

async function buy(
  d: Device,
  lines: ReturnType<typeof pLine>[],
  extra: Record<string, unknown> = {},
) {
  const id = newId();
  await runCommand(d.db, d.ctx, "purchase.create", {
    id,
    date: today,
    lines,
    paid: 10_000_000,
    ...extra,
  });
  return id;
}
async function sellTo(
  d: Device,
  lines: ReturnType<typeof sLine>[],
  extra: Record<string, unknown> = {},
) {
  const id = newId();
  await runCommand(d.db, d.ctx, "sale.create", {
    id,
    lines,
    tendered: 10_000_000,
    ...extra,
  });
  return id;
}

describe("purchases on a device", () => {
  it("brings stock in at once, reprices the product, numbers the purchase and tracks what is owed", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 5_000, 4000);
    const supplier = await addSupplier(d);
    const id = await buy(d, [pLine(milk, 10_000, 4500)], {
      supplierId: supplier,
      supplierName: "করিম ট্রেডার্স",
      paid: 15_000,
      invoiceRef: "INV-77",
    });

    expect(await stock(d, milk)).toBe(15_000);
    expect((await d.db.products.get(milk))?.purchasePrice).toBe(4500);
    const purchase = await d.db.purchases.get(id);
    expect(purchase).toMatchObject({
      total: 45_000,
      paid: 15_000,
      due: 30_000,
      invoiceRef: "INV-77",
    });
    expect(purchase?.purchaseNo).toMatch(/^P-[0-9A-F]{4}-\d{4}-0001$/);
    expect(
      await d.db.purchaseItems.where("purchaseId").equals(id).count(),
    ).toBe(1);
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(30_000);
    expect(
      (
        await d.db.ledgerEntries.where("partyId").equals(supplier).toArray()
      ).map((e) => e.amountDelta),
    ).toEqual([30_000]);
  });

  it("syncs to a second device with its lines, the stock, the new cost and the supplier balance", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 5_000, 4000);
    const supplier = await addSupplier(a);
    const id = await buy(a, [pLine(milk, 10_000, 4500)], {
      supplierId: supplier,
      supplierName: "X",
      paid: 0,
    });
    await a.sync();
    await b.sync();
    expect(await b.db.purchases.get(id)).toMatchObject({ due: 45_000 });
    expect(
      await b.db.purchaseItems.where("purchaseId").equals(id).count(),
    ).toBe(1);
    expect(await stock(b, milk)).toBe(15_000);
    expect((await b.db.products.get(milk))?.purchasePrice).toBe(4500);
    expect((await b.db.suppliers.get(supplier))?.balance).toBe(45_000);
    expect(
      (await b.db.suppliers.where("searchWords").startsWith("করিম").toArray())
        .length,
    ).toBe(1);
  });
});

describe("dues and payments", () => {
  it("collecting a due lowers the balance at once and converges across devices", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 100_000);
    const customer = await addCustomer(a);
    await sellTo(a, [sLine(milk, 2000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 0,
    }); // owes 10,000
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    b.faults.offline = true;
    await runCommand(a.db, a.ctx, "payment.collect", {
      id: newId(),
      partyId: customer,
      amount: 3_000,
    });
    await runCommand(b.db, b.ctx, "payment.collect", {
      id: newId(),
      partyId: customer,
      amount: 2_000,
    });
    expect((await a.db.customers.get(customer))?.balance).toBe(7_000);
    expect((await b.db.customers.get(customer))?.balance).toBe(8_000);
    a.faults.offline = false;
    b.faults.offline = false;
    await a.sync();
    await b.sync();
    await a.sync();

    for (const d of [a, b]) {
      expect((await d.db.customers.get(customer))?.balance).toBe(5_000);
      expect(
        await d.db.payments.where("partyId").equals(customer).count(),
      ).toBe(2);
    }
    expect(
      (
        await mongo.db
          .collection("customers")
          .findOne({ _id: customer as never })
      )?.balance,
    ).toBe(5_000);
  });

  it("keeps an unsynced payment in the balance when another device's sale arrives first", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 100_000);
    const customer = await addCustomer(a);
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    await runCommand(a.db, a.ctx, "payment.collect", {
      id: newId(),
      partyId: customer,
      amount: 1_000,
    }); // advance of 10
    await sellTo(b, [sLine(milk, 2000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 0,
    }); // owes 10,000
    await b.sync();
    a.faults.offline = false;
    await pullAll(a.db, a.transport);
    expect((await a.db.customers.get(customer))?.balance).toBe(10_000 - 1_000);
    await a.sync();
    expect(await pending(a)).toBe(0);
    expect(
      (
        await mongo.db
          .collection("customers")
          .findOne({ _id: customer as never })
      )?.balance,
    ).toBe(9_000);
  });

  it("paying a supplier lowers what we owe them", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 0);
    const supplier = await addSupplier(d);
    await buy(d, [pLine(milk, 10_000, 4500)], {
      supplierId: supplier,
      supplierName: "X",
      paid: 0,
    });
    await runCommand(d.db, d.ctx, "payment.pay", {
      id: newId(),
      partyId: supplier,
      amount: 20_000,
      method: "bank",
    });
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(25_000);
    await d.sync();
    expect(
      (
        await mongo.db
          .collection("suppliers")
          .findOne({ _id: supplier as never })
      )?.balance,
    ).toBe(25_000);
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(25_000);
  });

  it("rejects a payment to nobody and changes nothing", async () => {
    const d = await newDevice();
    await expect(
      runCommand(d.db, d.ctx, "payment.collect", {
        id: newId(),
        partyId: "ghost",
        amount: 100,
      }),
    ).rejects.toThrow();
    expect(await d.db.payments.count()).toBe(0);
    expect(await d.db.outbox.count()).toBe(0);
  });
});

describe("cancelling a payment", () => {
  async function owedCustomer(d: Device, due = 10_000) {
    const milk = await addProduct(d, 100_000);
    const customer = await addCustomer(d);
    await sellTo(d, [sLine(milk, 2000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 0,
    }); // owes 10,000
    await d.sync();
    expect((await d.db.customers.get(customer))?.balance).toBe(due);
    return customer;
  }
  const collect = async (d: Device, partyId: string, amount: number) => {
    const id = newId();
    await runCommand(d.db, d.ctx, "payment.collect", { id, partyId, amount });
    return id;
  };

  it("puts the balance back at once, keeps the payment, and converges across devices", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const customer = await owedCustomer(a);
    await b.sync();
    const payment = await collect(a, customer, 4_000);
    await a.sync();
    expect((await a.db.customers.get(customer))?.balance).toBe(6_000);

    a.faults.offline = true;
    await runCommand(a.db, a.ctx, "payment.void", {
      id: payment,
      reason: "wrong customer",
    });
    // On this device, immediately:
    expect((await a.db.customers.get(customer))?.balance).toBe(10_000);
    expect(await a.db.payments.get(payment)).toMatchObject({
      status: "voided",
      voidReason: "wrong customer",
      amount: 4_000,
    });
    const reversal = await a.db.ledgerEntries.get(`${payment}:vl`);
    expect(reversal).toMatchObject({
      amountDelta: 4_000,
      refType: "payment_void",
    });

    a.faults.offline = false;
    await a.sync();
    await b.sync();
    for (const d of [a, b]) {
      expect((await d.db.customers.get(customer))?.balance).toBe(10_000);
      expect((await d.db.payments.get(payment))?.status).toBe("voided");
    }
    expect(
      (
        await mongo.db
          .collection("customers")
          .findOne({ _id: customer as never })
      )?.balance,
    ).toBe(10_000);
    expect(await pending(a)).toBe(0);
  });

  it("an unsent cancellation still shows after other changes arrive", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const customer = await owedCustomer(a);
    const payment = await collect(a, customer, 4_000);
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    await runCommand(a.db, a.ctx, "payment.void", { id: payment, reason: "x" });
    await collect(b, customer, 1_000); // another device keeps working
    await b.sync();
    a.faults.offline = false;
    await pullAll(a.db, a.transport);
    // 10,000 owed, minus b's 1,000; a's payment of 4,000 is cancelled (not yet sent).
    expect((await a.db.customers.get(customer))?.balance).toBe(9_000);
    expect((await a.db.payments.get(payment))?.status).toBe("voided");
    await a.sync();
    expect(
      (
        await mongo.db
          .collection("customers")
          .findOne({ _id: customer as never })
      )?.balance,
    ).toBe(9_000);
  });

  it("works for a supplier too", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 0);
    const supplier = await addSupplier(d);
    await buy(d, [pLine(milk, 10_000, 4500)], {
      supplierId: supplier,
      supplierName: "X",
      paid: 0,
    });
    const id = newId();
    await runCommand(d.db, d.ctx, "payment.pay", {
      id,
      partyId: supplier,
      amount: 20_000,
      method: "bank",
    });
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(25_000);
    await runCommand(d.db, d.ctx, "payment.void", { id, reason: "typo" });
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(45_000);
    await d.sync();
    expect(
      (
        await mongo.db
          .collection("suppliers")
          .findOne({ _id: supplier as never })
      )?.balance,
    ).toBe(45_000);
  });

  it("cannot be cancelled twice, or for a payment this device does not have", async () => {
    const d = await newDevice();
    const customer = await owedCustomer(d);
    const payment = await collect(d, customer, 1_000);
    await runCommand(d.db, d.ctx, "payment.void", { id: payment, reason: "a" });
    await expect(
      runCommand(d.db, d.ctx, "payment.void", { id: payment, reason: "b" }),
    ).rejects.toThrow();
    await expect(
      runCommand(d.db, d.ctx, "payment.void", { id: newId(), reason: "c" }),
    ).rejects.toThrow();
    expect((await d.db.customers.get(customer))?.balance).toBe(10_000);
  });

  it("if the server refuses it, the device goes back to the payment being active", async () => {
    const d = await newDevice();
    const customer = await owedCustomer(d);
    const payment = await collect(d, customer, 4_000);
    await d.sync();
    // The server no longer has the payment (so it refuses the cancellation).
    await mongo.db.collection("payments").deleteOne({ _id: payment as never });
    await runCommand(d.db, d.ctx, "payment.void", { id: payment, reason: "x" });
    expect((await d.db.customers.get(customer))?.balance).toBe(10_000);
    await d.sync();
    const [op] = await d.db.outbox
      .where("operationId")
      .equals(
        (await d.db.outbox.toArray()).filter(
          (o) => o.type === "payment.void",
        )[0].operationId,
      )
      .toArray();
    expect(op).toMatchObject({ status: "failed", lastError: "NOT_FOUND" });
    expect((await d.db.payments.get(payment))?.status).not.toBe("voided");
    expect((await d.db.customers.get(customer))?.balance).toBe(6_000);
    expect(await d.db.ledgerEntries.get(`${payment}:vl`)).toBeUndefined();
  });
});

describe("expenses", () => {
  it("records, syncs and cancels expenses", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const id = newId();
    await runCommand(a.db, a.ctx, "expense.create", {
      id,
      category: "rent",
      amount: 500_000,
      date: today,
      description: "অক্টোবর",
    });
    await a.sync();
    await b.sync();
    expect(await b.db.expenses.get(id)).toMatchObject({
      amount: 500_000,
      status: "active",
      category: "rent",
    });

    await runCommand(b.db, b.ctx, "expense.void", { id, reason: "mistake" });
    expect((await b.db.expenses.get(id))?.status).toBe("voided");
    await b.sync();
    await a.sync();
    expect(await a.db.expenses.get(id)).toMatchObject({
      status: "voided",
      voidReason: "mistake",
      amount: 500_000,
    });
  });
});

describe("returns", () => {
  it("a sale return restocks, credits the customer and cannot exceed what was sold (locally and on the server)", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 10_000);
    const customer = await addCustomer(a);
    const saleId = await sellTo(a, [sLine(milk, 4000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 5_000,
    }); // owes 15,000
    await a.sync();
    await b.sync();

    const line = (qty: number) => [
      {
        itemIndex: 0,
        productId: milk,
        productName: "Fresh Milk",
        productNameBn: "",
        unit: "pcs" as const,
        qty,
        unitPrice: 5000,
      },
    ];
    await runCommand(b.db, b.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: line(1_000),
      settlement: "credit",
    });
    expect(await stock(b, milk)).toBe(7_000);
    expect((await b.db.customers.get(customer))?.balance).toBe(10_000);
    const ret = (await b.db.returns.toArray())[0];
    expect(ret).toMatchObject({
      kind: "sale",
      refId: saleId,
      total: 5_000,
      settlement: "credit",
    });
    expect(ret.returnNo).toMatch(/^R-[0-9A-F]{4}-\d{4}-0001$/);

    // Only 3 more can come back, on this device...
    await expect(
      runCommand(b.db, b.ctx, "saleReturn.create", {
        id: newId(),
        saleId,
        lines: line(4_000),
      }),
    ).rejects.toThrow("RETURN_TOO_MUCH");

    await b.sync();
    await a.sync();
    for (const d of [a, b]) {
      expect(await stock(d, milk)).toBe(7_000);
      expect((await d.db.customers.get(customer))?.balance).toBe(10_000);
      expect(await d.db.returns.count()).toBe(1);
    }
    // ...and the original sale was never touched.
    expect(await a.db.sales.get(saleId)).toMatchObject({
      status: "active",
      total: 20_000,
      due: 15_000,
    });
  });

  it("two devices returning the same goods: one is accepted, the other is rejected and undone on screen", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 10_000);
    const saleId = await sellTo(a, [sLine(milk, 4000)]);
    await a.sync();
    await b.sync();

    const line = [
      {
        itemIndex: 0,
        productId: milk,
        productName: "Fresh Milk",
        productNameBn: "",
        unit: "pcs" as const,
        qty: 3_000,
        unitPrice: 5000,
      },
    ];
    a.faults.offline = true;
    b.faults.offline = true;
    await runCommand(a.db, a.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: line,
    });
    await runCommand(b.db, b.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: line,
    });
    a.faults.offline = false;
    b.faults.offline = false;
    await a.sync();
    await b.sync();
    await a.sync();

    const failed = await b.db.outbox.where("status").equals("failed").toArray();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      type: "saleReturn.create",
      lastError: "RETURN_TOO_MUCH",
    });
    expect(
      await mongo.db.collection("returns").countDocuments({ refId: saleId }),
    ).toBe(1);
    expect(
      await mongo.db.collection("products").findOne({ _id: milk as never }),
    ).toMatchObject({ stock: 6_000 + 3_000 });
  });

  it("a purchase return sends goods back and reduces the supplier balance", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 0);
    const supplier = await addSupplier(d);
    const purchaseId = await buy(d, [pLine(milk, 10_000, 4500)], {
      supplierId: supplier,
      supplierName: "X",
      paid: 0,
    });
    await runCommand(d.db, d.ctx, "purchaseReturn.create", {
      id: newId(),
      purchaseId,
      lines: [
        {
          itemIndex: 0,
          productId: milk,
          productName: "Fresh Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 2_000,
          unitCost: 4500,
        },
      ],
      settlement: "credit",
    });
    expect(await stock(d, milk)).toBe(8_000);
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(36_000);
    await d.sync();
    expect(
      (
        await mongo.db
          .collection("suppliers")
          .findOne({ _id: supplier as never })
      )?.balance,
    ).toBe(36_000);
    expect(await stock(d, milk)).toBe(8_000);
  });

  it("does not double-count when the acknowledgement of a return is lost", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 10_000);
    const saleId = await sellTo(d, [sLine(milk, 2000)]);
    await d.sync();
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: [
        {
          itemIndex: 0,
          productId: milk,
          productName: "Fresh Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 1_000,
          unitPrice: 5000,
        },
      ],
    });
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
    ).toBe(9_000);
    expect(await stock(d, milk)).toBe(9_000);
  });
});

describe("the cost of a purchased item on the device", () => {
  it("refuses zero and negative costs and changes nothing", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 5_000, 4_000);
    for (const unitCost of [0, -100]) {
      await expect(
        runCommand(d.db, d.ctx, "purchase.create", {
          id: newId(),
          supplierId: null,
          date: today,
          lines: [pLine(milk, 2_000, unitCost)],
          paid: 0,
          updateCosts: true,
        }),
      ).rejects.toThrow();
    }
    expect((await d.db.products.get(milk))?.purchasePrice).toBe(4_000);
    expect((await d.db.products.get(milk))?.stock).toBe(5_000);
    expect(await d.db.purchases.count()).toBe(0);
  });
});

describe("cancelling a sale that has come back in full (device)", () => {
  const back = (milk: string, qty: number) => [
    {
      itemIndex: 0,
      productId: milk,
      productName: "Fresh Milk",
      productNameBn: "",
      unit: "pcs" as const,
      qty,
      unitPrice: 5000,
    },
  ];

  it("is refused on the device and nothing changes, and so is cancelling a partly returned sale", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 10_000);
    const full = await sellTo(d, [sLine(milk, 3_000)]);
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId: full,
      lines: back(milk, 3_000),
    });
    expect(await stock(d, milk)).toBe(10_000);
    await expect(
      runCommand(d.db, d.ctx, "sale.void", { saleId: full, reason: "x" }),
    ).rejects.toThrow(/HAS_RETURNS/);
    expect((await d.db.sales.get(full))?.status).toBe("active");
    expect(await stock(d, milk)).toBe(10_000);

    const part = await sellTo(d, [sLine(milk, 4_000)]);
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId: part,
      lines: back(milk, 1_000),
    });
    await expect(
      runCommand(d.db, d.ctx, "sale.void", { saleId: part, reason: "x" }),
    ).rejects.toThrow(/HAS_RETURNS/);
    expect((await d.db.sales.get(part))?.status).toBe("active");
    expect(await stock(d, milk)).toBe(7_000);
  });
});

describe("returns, store credit and the way a refund is settled (device)", () => {
  const unit = (milk: string, qty: number) => [
    {
      itemIndex: 0,
      productId: milk,
      productName: "Fresh Milk",
      productNameBn: "",
      unit: "pcs" as const,
      qty,
      unitPrice: 5000,
    },
  ];
  const serverBalance = async (collection: string, id: string) =>
    (await mongo.db.collection(collection).findOne({ _id: id as never }))
      ?.balance;

  it("a sale uses the customer's store credit, and the device and the server agree", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 100_000);
    const customer = await addCustomer(d);
    await runCommand(d.db, d.ctx, "party.openingBalance", {
      id: newId(),
      partyType: "customer",
      partyId: customer,
      amount: -5_000, // paid ৳50 ahead
    });
    const saleId = await sellTo(d, [sLine(milk, 4_000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 15_000,
      creditUsed: 5_000,
    });
    expect(await d.db.sales.get(saleId)).toMatchObject({
      total: 20_000,
      creditUsed: 5_000,
      paid: 15_000,
      due: 0,
    });
    expect((await d.db.customers.get(customer))?.balance).toBe(0);
    await d.sync();
    expect(await serverBalance("customers", customer)).toBe(0);
    expect(
      await mongo.db.collection("sales").findOne({ _id: saleId as never }),
    ).toMatchObject({ creditUsed: 5_000, paid: 15_000, due: 0 });
  });

  it("credit the device does not really have is not used", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 100_000);
    const customer = await addCustomer(d);
    const saleId = await sellTo(d, [sLine(milk, 4_000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 15_000,
      creditUsed: 5_000,
    });
    expect(await d.db.sales.get(saleId)).toMatchObject({
      creditUsed: 0,
      due: 5_000,
    });
    expect((await d.db.customers.get(customer))?.balance).toBe(5_000);
  });

  it("the due comes off first: a credit sale returned in full leaves nothing owed, nothing handed back", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 100_000);
    const customer = await addCustomer(d);
    const saleId = await sellTo(d, [sLine(milk, 4_000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 0,
    });
    expect((await d.db.customers.get(customer))?.balance).toBe(20_000);
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: unit(milk, 4_000),
      cashBack: 0,
    });
    expect((await d.db.customers.get(customer))?.balance).toBe(0);
    expect((await d.db.returns.toArray())[0]).toMatchObject({
      total: 20_000,
      cashBack: 0,
      credited: 20_000,
      settlement: "credit",
    });
    await d.sync();
    expect(await serverBalance("customers", customer)).toBe(0);
  });

  it("a part cash, part off-the-due refund posts only the credited part to the ledger", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 100_000);
    const customer = await addCustomer(d);
    const saleId = await sellTo(d, [sLine(milk, 4_000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 10_000, // ৳100 now, ৳100 owed
    });
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: unit(milk, 4_000),
      cashBack: 10_000, // the ৳100 owed comes off, ৳100 goes back in cash
    });
    const ret = (await d.db.returns.toArray())[0];
    expect(ret).toMatchObject({ cashBack: 10_000, credited: 10_000 });
    expect((await d.db.customers.get(customer))?.balance).toBe(0);
    await d.sync();
    expect(await serverBalance("customers", customer)).toBe(0);
    expect(
      await mongo.db.collection("returns").findOne({ _id: ret.id as never }),
    ).toMatchObject({ cashBack: 10_000, credited: 10_000 });
  });

  it("the server keeps the split the device made, even if the balance moved meanwhile", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 100_000);
    const customer = await addCustomer(a);
    const saleId = await sellTo(a, [sLine(milk, 4_000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 0,
    }); // owes ৳200
    await a.sync();
    await b.sync();

    // A's screen offered "all off the due"; meanwhile B collected the whole ৳200.
    a.faults.offline = true;
    await runCommand(a.db, a.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: unit(milk, 4_000),
      cashBack: 0,
    });
    await runCommand(b.db, b.ctx, "payment.collect", {
      id: newId(),
      partyId: customer,
      amount: 20_000,
    });
    await b.sync();
    a.faults.offline = false;
    await a.sync();
    await b.sync();
    // Nothing is refused: the customer ends ৳200 ahead, as both really happened.
    expect(await serverBalance("customers", customer)).toBe(-20_000);
    expect((await a.db.customers.get(customer))?.balance).toBe(-20_000);
    expect(await pending(a)).toBe(0);
  });

  it("an unsent return keeps only its credited part on the balance when someone else's changes arrive", async () => {
    const a = await newDevice();
    const b = await newDevice();
    const milk = await addProduct(a, 100_000);
    const customer = await addCustomer(a);
    const saleId = await sellTo(a, [sLine(milk, 4_000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 0,
    }); // owes ৳200
    await a.sync();
    await b.sync();

    a.faults.offline = true;
    await runCommand(a.db, a.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: unit(milk, 4_000),
      cashBack: 8_000, // ৳120 comes off what is owed, ৳80 is handed back
    });
    expect((await a.db.customers.get(customer))?.balance).toBe(8_000);
    await runCommand(b.db, b.ctx, "payment.collect", {
      id: newId(),
      partyId: customer,
      amount: 2_000,
    });
    await b.sync();
    a.faults.offline = false;
    await pullAll(a.db, a.transport);
    // The server says ৳180 is owed; A's own unsent return takes ৳120 off that, not the whole ৳200.
    expect((await a.db.customers.get(customer))?.balance).toBe(6_000);
    await a.sync();
    expect(await serverBalance("customers", customer)).toBe(6_000);
    expect((await a.db.customers.get(customer))?.balance).toBe(6_000);
  });

  it("a refund of a sale that used store credit gives that credit back, as credit", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 100_000);
    const customer = await addCustomer(d);
    await runCommand(d.db, d.ctx, "party.openingBalance", {
      id: newId(),
      partyType: "customer",
      partyId: customer,
      amount: -5_000,
    });
    const saleId = await sellTo(d, [sLine(milk, 4_000)], {
      customerId: customer,
      customerName: "রহিম",
      tendered: 15_000,
      creditUsed: 5_000,
    });
    // What the screen offers: ৳50 back as credit, ৳150 in cash.
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: unit(milk, 4_000),
      cashBack: 15_000,
    });
    expect((await d.db.customers.get(customer))?.balance).toBe(-5_000);
    await d.sync();
    expect(await serverBalance("customers", customer)).toBe(-5_000);
  });

  it("a purchase return settles like a sale return: part off what we owe, part cash from the supplier", async () => {
    const d = await newDevice();
    const milk = await addProduct(d, 0);
    const supplier = await addSupplier(d);
    const purchaseId = await buy(d, [pLine(milk, 10_000, 4500)], {
      supplierId: supplier,
      supplierName: "X",
      paid: 0,
    }); // we owe ৳450
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(45_000);
    await runCommand(d.db, d.ctx, "purchaseReturn.create", {
      id: newId(),
      purchaseId,
      lines: [
        {
          itemIndex: 0,
          productId: milk,
          productName: "Fresh Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 10_000,
          unitCost: 4500,
        },
      ],
      cashBack: 15_000, // ৳150 received in cash, ৳300 comes off what we owe
    });
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(15_000);
    const ret = (await d.db.returns.toArray())[0];
    expect(ret).toMatchObject({
      total: 45_000,
      cashBack: 15_000,
      credited: 30_000,
    });
    await d.sync();
    expect(await serverBalance("suppliers", supplier)).toBe(15_000);
  });
});
