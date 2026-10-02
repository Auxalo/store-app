import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { serverSummary, serverSummaryCached } from "@/server/reports";
import { createDevice, type Device } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { dayKey, daysIn, rangeBounds } from "../compute";
import { loadStock, loadSummary } from "../local";

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

const line = (
  productId: string,
  name: string,
  qty: number,
  price: number,
  cost: number,
) => ({
  productId,
  productName: name,
  productNameBn: "",
  unit: "pcs" as const,
  qty,
  listPrice: price,
  unitPrice: price,
  unitCost: cost,
  discount: 0,
});

async function product(d: Device, name: string, price: number, cost: number) {
  const id = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id,
    name,
    nameBn: "",
    sellingPrice: price,
    purchasePrice: cost,
    openingStock: 100_000,
    openingMovementId: newId(),
  });
  return id;
}

describe("reports: a device and the server agree", () => {
  it("gives the same totals from the phone that sold, a second phone, and the server", async () => {
    const a = await createDevice(mongo, storeId, "owner", ownerId);
    const b = await createDevice(mongo, storeId, "owner", ownerId);
    const milk = await product(a, "Milk", 5000, 4000);
    const rice = await product(a, "Rice", 12_000, 8000);
    const customer = newId();
    await runCommand(a.db, a.ctx, "customer.create", {
      id: customer,
      name: "রহিম",
      phone: "01700000000",
    });

    const s1 = newId();
    await runCommand(a.db, a.ctx, "sale.create", {
      id: s1,
      lines: [line(milk, "Milk", 2000, 5000, 4000)],
      tendered: 1_000_000,
    });
    const s2 = newId();
    await runCommand(a.db, a.ctx, "sale.create", {
      id: s2,
      lines: [
        line(rice, "Rice", 1000, 12_000, 8000),
        line(milk, "Milk", 1000, 5000, 4000),
      ],
      discount: 1000,
      customerId: customer,
      customerName: "রহিম",
      tendered: 6000,
      paymentMethod: "bkash",
    });
    const cancelled = newId();
    await runCommand(a.db, a.ctx, "sale.create", {
      id: cancelled,
      lines: [line(rice, "Rice", 5000, 12_000, 8000)],
      tendered: 1_000_000,
    });
    await runCommand(a.db, a.ctx, "sale.void", {
      saleId: cancelled,
      reason: "mistake",
    });

    await runCommand(a.db, a.ctx, "saleReturn.create", {
      id: newId(),
      saleId: s1,
      lines: [
        {
          itemIndex: 0,
          productId: milk,
          productName: "Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 1000,
          unitPrice: 5000,
        },
      ],
      settlement: "cash",
    });

    const today = dayKey(Date.now());
    await runCommand(a.db, a.ctx, "expense.create", {
      id: newId(),
      category: "rent",
      amount: 20_000,
      date: today,
      description: "",
    });
    const supplier = newId();
    await runCommand(a.db, a.ctx, "supplier.create", {
      id: supplier,
      name: "করিম",
    });
    await runCommand(a.db, a.ctx, "purchase.create", {
      id: newId(),
      supplierId: supplier,
      supplierName: "করিম",
      date: today,
      lines: [
        {
          productId: milk,
          productName: "Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 10_000,
          unitCost: 4500,
          discount: 0,
        },
      ],
      paid: 20_000,
    });

    await a.sync();
    await b.sync();

    const range = {
      from: dayKey(Date.now() - 86_400_000),
      to: dayKey(Date.now() + 86_400_000),
    };
    const fromA = await loadSummary(a.db, range);
    const fromB = await loadSummary(b.db, range);
    const fromServer = JSON.parse(
      JSON.stringify(await serverSummary(mongo.db, storeId, range)),
    );

    expect(JSON.parse(JSON.stringify(fromB))).toEqual(
      JSON.parse(JSON.stringify(fromA)),
    );
    expect(fromServer).toEqual(JSON.parse(JSON.stringify(fromA)));

    // And the numbers are right: 10,000 + 16,000 sold, 5,000 returned; the cancelled sale is ignored.
    expect(fromA).toMatchObject({
      salesCount: 2,
      total: 26_000,
      discount: 1000,
      returns: 5000,
      netSales: 21_000,
      cost: 16_000,
      profit: 5000,
      expenses: 20_000,
      netProfit: -15_000,
      due: 10_000,
      purchasesCount: 1,
      purchasesTotal: 45_000,
      purchasesDue: 25_000,
    });
    expect(fromA.byProduct.reduce((s, p) => s + p.revenue, 0)).toBe(
      fromA.netSales,
    );
    expect(fromA.byProduct.reduce((s, p) => s + p.profit, 0)).toBe(
      fromA.profit,
    );
    expect(fromA.byDay.reduce((s, d) => s + d.sales, 0)).toBe(fromA.netSales);
    expect(fromA.byPayment.map((p) => [p.method, p.total])).toEqual([
      ["bkash", 16_000],
      ["cash", 10_000],
    ]);
    expect(fromA.expensesByCategory).toEqual([
      { category: "rent", total: 20_000 },
    ]);

    // A tight range around today gives the same answer as the generous one.
    const todayOnly = { from: dayKey(Date.now()), to: dayKey(Date.now()) };
    expect((await loadSummary(a.db, todayOnly)).total).toBe(26_000);
    expect((await serverSummary(mongo.db, storeId, todayOnly)).total).toBe(
      26_000,
    );

    // A range with nothing in it is all zeros, one row per day.
    const empty = await loadSummary(a.db, {
      from: "2020-01-01",
      to: "2020-01-03",
    });
    expect(empty).toMatchObject({
      salesCount: 0,
      total: 0,
      profit: 0,
      netProfit: 0,
    });
    expect(empty.byDay).toHaveLength(3);

    const stock = await loadStock(a.db);
    expect(stock.rows).toHaveLength(2);
    expect(stock.costValue).toBeGreaterThan(0);
  });
});

describe("days", () => {
  it("turns a store day into UTC instants that compare correctly with stored timestamps", () => {
    // Dhaka is UTC+6: the 2nd starts at 18:00 UTC on the 1st.
    expect(rangeBounds({ from: "2026-10-02", to: "2026-10-02" })).toEqual({
      start: "2026-10-01T18:00:00.000Z",
      end: "2026-10-02T18:00:00.000Z",
    });
  });

  it("lists every day in a range, across a month end", () => {
    expect(daysIn({ from: "2026-02-27", to: "2026-03-02" })).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });
  it("uses the store's day, not UTC", () => {
    // 20:00 UTC on the 1st is 02:00 on the 2nd in Dhaka.
    expect(dayKey("2026-10-01T20:00:00.000Z")).toBe("2026-10-02");
  });
});

describe("the server's report cache", () => {
  it("keeps a report until something changes in the shop", async () => {
    const range = { from: dayKey(Date.now()), to: dayKey(Date.now()) };
    const first = await serverSummaryCached(mongo.db, storeId, range);
    expect(first).toEqual(await serverSummary(mongo.db, storeId, range));

    // Nothing changed: the same answer, without going through the sales again.
    expect(await serverSummaryCached(mongo.db, storeId, range)).toBe(first);

    // Anything saved moves the shop's change counter, and the report is worked out afresh.
    await mongo.db
      .collection("stores")
      .updateOne({ _id: storeId as never }, { $inc: { syncSeq: 1 } });
    const after = await serverSummaryCached(mongo.db, storeId, range);
    expect(after).not.toBe(first);
    expect(after).toEqual(first);
  });
});
