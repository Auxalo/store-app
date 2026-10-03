import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { headOf, hideCostInChanges } from "../data/service";
import { runOnlineCommand } from "../online-commands";

let mongo: TestMongo;
let storeId: string;
let owner: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  owner = await mongo.seedUser(storeId, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const actor = () => ({
  id: owner,
  role: "owner" as const,
  storeId,
  deviceId: "d",
});

describe("what a save sends back", () => {
  it("leaves out purchase prices and the cost of sold goods for someone who may not see them", async () => {
    const productId = randomUUID();
    const created = await runOnlineCommand(mongo, actor(), {
      operationId: randomUUID(),
      type: "product.create",
      input: {
        id: productId,
        name: "Milk",
        purchasePrice: 4000,
        sellingPrice: 5000,
        openingStock: 100_000,
        openingMovementId: randomUUID(),
      },
    });
    const sold = await runOnlineCommand(mongo, actor(), {
      operationId: randomUUID(),
      type: "sale.create",
      input: {
        id: randomUUID(),
        lines: [
          {
            productId,
            productName: "Milk",
            productNameBn: "",
            unit: "pcs",
            qty: 1000,
            listPrice: 5000,
            unitPrice: 5000,
            unitCost: 0,
            discount: 0,
          },
        ],
        discount: 0,
        tendered: 5000,
        paymentMethod: "cash",
        notes: "",
      },
    });
    if (!created.ok || !sold.ok) throw new Error("setup failed");

    // The owner sees cost, as before.
    const asOwner = JSON.stringify(
      hideCostInChanges(sold.docs, { canSeeCost: true }),
    );
    expect(asOwner).toContain("unitCost");
    expect(asOwner).toContain("purchasePrice");

    // A cashier does not: neither on the product that changed nor on the sale's lines.
    const asCashier = hideCostInChanges(sold.docs, { canSeeCost: false });
    expect(JSON.stringify(asCashier)).not.toContain("unitCost");
    expect(JSON.stringify(asCashier)).not.toContain("purchasePrice");
    // ...and the receipt still has its lines.
    const sale = asCashier.find((c) => c.collection === "sales")
      ?.doc as unknown as {
      items: unknown[];
    };
    expect(sale.items).toHaveLength(1);
    // A product created by the same cashier-visible path hides its purchase price too.
    expect(
      JSON.stringify(hideCostInChanges(created.docs, { canSeeCost: false })),
    ).not.toContain("purchasePrice");
  });

  it("reports how far the shop's changes have got", async () => {
    const result = await runOnlineCommand(mongo, actor(), {
      operationId: randomUUID(),
      type: "expense.create",
      input: {
        id: randomUUID(),
        category: "rent",
        amount: 1000,
        date: "2026-10-02",
        description: "",
      },
    });
    if (!result.ok) throw new Error("setup failed");
    const store = await mongo.db
      .collection<{ _id: string; syncSeq: number }>("stores")
      .findOne({ _id: storeId });
    expect(headOf(result.docs)).toBe(store?.syncSeq);
  });
});
