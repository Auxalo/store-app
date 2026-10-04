import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { createDevice, type Device } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { undoLocalEffects } from "../undo";

let mongo: TestMongo;
let storeId: string;
let ownerId: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore("Undo Shop");
  ownerId = await mongo.seedUser(storeId, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const line = (productId: string, qty = 1000) => ({
  productId,
  productName: "Milk",
  productNameBn: "",
  unit: "pcs" as const,
  qty,
  listPrice: 5000,
  unitPrice: 5000,
  unitCost: 4000,
  discount: 0,
});

async function shop() {
  const d = await createDevice(mongo, storeId, "owner", ownerId);
  const product = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id: product,
    name: "Milk",
    sellingPrice: 5000,
    purchasePrice: 4000,
    openingStock: 100_000,
    openingMovementId: newId(),
  });
  const customer = newId();
  await runCommand(d.db, d.ctx, "customer.create", { id: customer, name: "R" });
  return { d, product, customer };
}

const opOf = (d: Device, type: string) =>
  d.db.outbox.filter((op) => op.type === type).first();

describe("taking back what a refused operation did on the device", () => {
  it("a collected payment: the balance and the payment record go back", async () => {
    const { d, product, customer } = await shop();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: newId(),
      customerId: customer,
      customerName: "R",
      lines: [line(product, 2000)],
      tendered: 0,
    });
    expect((await d.db.customers.get(customer))?.balance).toBe(10_000);
    const paymentId = newId();
    await runCommand(d.db, d.ctx, "payment.collect", {
      id: paymentId,
      partyId: customer,
      amount: 4000,
    });
    expect((await d.db.customers.get(customer))?.balance).toBe(6_000);

    const op = await opOf(d, "payment.collect");
    await d.db.transaction("rw", d.db.tables, () =>
      undoLocalEffects(d.db, op as never),
    );
    expect((await d.db.customers.get(customer))?.balance).toBe(10_000);
    expect(await d.db.payments.get(paymentId)).toBeUndefined();
  });

  it("a cancelled sale: stock, balance and the sale's status go back", async () => {
    const { d, product, customer } = await shop();
    const saleId = newId();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: saleId,
      customerId: customer,
      customerName: "R",
      lines: [line(product, 2000)],
      tendered: 0,
    });
    await runCommand(d.db, d.ctx, "sale.void", { saleId, reason: "x" });
    expect((await d.db.products.get(product))?.stock).toBe(100_000);
    expect((await d.db.sales.get(saleId))?.status).toBe("voided");

    const op = await opOf(d, "sale.void");
    await d.db.transaction("rw", d.db.tables, () =>
      undoLocalEffects(d.db, op as never),
    );
    expect((await d.db.products.get(product))?.stock).toBe(98_000);
    expect((await d.db.customers.get(customer))?.balance).toBe(10_000);
    expect((await d.db.sales.get(saleId))?.status).toBe("active");
    // The sale's own records are untouched.
    expect(await d.db.saleItems.where("saleId").equals(saleId).count()).toBe(1);
  });

  it("a return: the goods and the credit go back", async () => {
    const { d, product, customer } = await shop();
    const saleId = newId();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: saleId,
      customerId: customer,
      customerName: "R",
      lines: [line(product, 2000)],
      tendered: 0,
    });
    const returnId = newId();
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: returnId,
      saleId,
      lines: [
        {
          itemIndex: 0,
          productId: product,
          productName: "Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 1000,
          unitPrice: 5000,
        },
      ],
      settlement: "credit",
      restock: true,
    });
    expect((await d.db.products.get(product))?.stock).toBe(99_000);
    expect((await d.db.customers.get(customer))?.balance).toBe(5_000);

    const op = await opOf(d, "saleReturn.create");
    await d.db.transaction("rw", d.db.tables, () =>
      undoLocalEffects(d.db, op as never),
    );
    expect((await d.db.products.get(product))?.stock).toBe(98_000);
    expect((await d.db.customers.get(customer))?.balance).toBe(10_000);
  });

  it("a purchase: the stock, the lines and what is owed to the supplier go back", async () => {
    const { d, product } = await shop();
    const supplier = newId();
    await runCommand(d.db, d.ctx, "supplier.create", {
      id: supplier,
      name: "S",
    });
    const purchaseId = newId();
    await runCommand(d.db, d.ctx, "purchase.create", {
      id: purchaseId,
      supplierId: supplier,
      supplierName: "S",
      date: "2026-10-05",
      lines: [
        {
          productId: product,
          productName: "Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 5000,
          unitCost: 4000,
          discount: 0,
        },
      ],
      paid: 0,
    });
    expect((await d.db.products.get(product))?.stock).toBe(105_000);
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(20_000);

    const op = await opOf(d, "purchase.create");
    await d.db.transaction("rw", d.db.tables, () =>
      undoLocalEffects(d.db, op as never),
    );
    expect((await d.db.products.get(product))?.stock).toBe(100_000);
    expect((await d.db.suppliers.get(supplier))?.balance).toBe(0);
    expect(
      await d.db.purchaseItems.where("purchaseId").equals(purchaseId).count(),
    ).toBe(0);
  });

  it("running it twice changes nothing the second time", async () => {
    const { d, product, customer } = await shop();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: newId(),
      customerId: customer,
      customerName: "R",
      lines: [line(product, 2000)],
      tendered: 0,
    });
    const op = await opOf(d, "sale.create");
    const undo = () =>
      d.db.transaction("rw", d.db.tables, () =>
        undoLocalEffects(d.db, op as never),
      );
    await undo();
    await undo();
    expect((await d.db.products.get(product))?.stock).toBe(100_000);
    expect((await d.db.customers.get(customer))?.balance).toBe(0);
  });
});
