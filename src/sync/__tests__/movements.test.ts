import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { dayKey } from "@/reports/compute";
import {
  aggregateMovements,
  foldMovements,
  type MovementAgg,
} from "@/reports/movements";
import { loadMovementSummary } from "@/reports/movements-local";
import { serverMovementSummary } from "@/server/movements";
import { createDevice } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";

let mongo: TestMongo;
let storeId: string;
let ownerId: string;

const TZ = "Asia/Dhaka";

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  ownerId = await mongo.seedUser(storeId, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

describe("the stock in / out fold", () => {
  it("counts in and out by sign, and a cancelled sale undoes the sale instead of counting as goods in", () => {
    const rows: MovementAgg[] = aggregateMovements([
      { productId: "p1", type: "opening", qtyDelta: 100_000 },
      { productId: "p1", type: "sale", refType: "sale", qtyDelta: -5_000 },
      // the cancellation of that sale puts the goods back
      {
        productId: "p1",
        type: "sale_return",
        refType: "sale_void",
        qtyDelta: 5_000,
      },
      // a real customer return
      {
        productId: "p1",
        type: "sale_return",
        refType: "sale_return",
        qtyDelta: 1_000,
      },
      { productId: "p1", type: "damage", qtyDelta: -2_000 },
    ]);
    const [card] = foldMovements(rows);
    expect(card.in).toEqual({ opening: 100_000, sale_return: 1_000 });
    expect(card.out).toEqual({ damage: 2_000 }); // the cancelled sale nets to nothing
    expect(card.totalIn).toBe(101_000);
    expect(card.totalOut).toBe(2_000);
  });

  it("leaves out a product whose movements add to nothing, and lists the busiest first", () => {
    const cards = foldMovements(
      aggregateMovements([
        { productId: "a", type: "sale", refType: "sale", qtyDelta: -1_000 },
        {
          productId: "a",
          type: "sale_return",
          refType: "sale_void",
          qtyDelta: 1_000,
        },
        { productId: "b", type: "purchase", qtyDelta: 3_000 },
        { productId: "c", type: "purchase", qtyDelta: 9_000 },
      ]),
    );
    expect(cards.map((c) => c.productId)).toEqual(["c", "b"]);
  });
});

describe("stock in and out per product, on the device and on the server", () => {
  it("gives the same cards on both, and they add up to the stock", async () => {
    const d = await createDevice(mongo, storeId, "owner", ownerId);
    const today = dayKey(Date.now(), TZ);
    const milk = newId();
    await runCommand(d.db, d.ctx, "product.create", {
      id: milk,
      name: "Fresh Milk",
      nameBn: "",
      sellingPrice: 5000,
      purchasePrice: 4000,
      openingStock: 100_000,
      openingMovementId: newId(),
    });
    const line = (qty: number) => ({
      productId: milk,
      productName: "Fresh Milk",
      productNameBn: "",
      unit: "pcs" as const,
      qty,
      listPrice: 5000,
      unitPrice: 5000,
      unitCost: 4000,
      discount: 0,
    });
    await runCommand(d.db, d.ctx, "purchase.create", {
      id: newId(),
      date: today,
      lines: [
        {
          productId: milk,
          productName: "Fresh Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 20_000,
          unitCost: 4000,
          discount: 0,
        },
      ],
      paid: 80_000,
    });
    // A sale that is cancelled again, a sale of 4 with 1 coming back, and 1 damaged.
    const cancelled = newId();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: cancelled,
      lines: [line(5_000)],
      tendered: 25_000,
    });
    await runCommand(d.db, d.ctx, "sale.void", {
      saleId: cancelled,
      reason: "mistake",
    });
    const kept = newId();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: kept,
      lines: [line(4_000)],
      tendered: 20_000,
    });
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId: kept,
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
    await runCommand(d.db, d.ctx, "stock.adjust", {
      productId: milk,
      movementId: newId(),
      type: "damage",
      qtyDelta: -1_000,
    });

    const range = { from: today, to: today };
    const device = await loadMovementSummary(d.db, range, TZ);
    expect(device.rows).toHaveLength(1);
    expect(device.rows[0]).toMatchObject({
      name: "Fresh Milk",
      unit: "pcs",
      in: { opening: 100_000, purchase: 20_000, sale_return: 1_000 },
      out: { sale: 4_000, damage: 1_000 },
      totalIn: 121_000,
      totalOut: 5_000,
      stock: 116_000, // 100 + 20 − 5 + 5 − 4 + 1 − 1
    });
    // In minus out is exactly what the stock changed by.
    expect(device.rows[0].totalIn - device.rows[0].totalOut).toBe(116_000);

    await d.sync();
    expect(await serverMovementSummary(mongo.db, storeId, range, TZ)).toEqual(
      device,
    );
    // A day with nothing in it has no cards.
    const quiet = await loadMovementSummary(
      d.db,
      { from: "2020-01-01", to: "2020-01-02" },
      TZ,
    );
    expect(quiet.rows).toEqual([]);
  });
});
