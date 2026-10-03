/**
 * QA audit, part 3: the device side of sync and the switch between modes (findings S3, D1, D2).
 * See docs/QA-REPORT.md.
 */
import "fake-indexeddb/auto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runCommand } from "@/commands/local/run";
import { drainForOnline, removeOfflineData } from "@/data/mode-switch";
import { newId } from "@/lib/ids";
import { createDevice } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
let storeId: string;
let ownerId: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore("QA Sync 2 Shop");
  ownerId = await mongo.seedUser(storeId, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const newDevice = () => createDevice(mongo, storeId, "owner", ownerId);

const line = (productId: string, qty: number) => ({
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

async function product(d: Awaited<ReturnType<typeof newDevice>>) {
  const id = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id,
    name: "Milk",
    sellingPrice: 5000,
    purchasePrice: 4000,
    openingStock: 100_000,
    openingMovementId: newId(),
  });
  return id;
}

describe("QA S3: the answer to a sale was lost", () => {
  it("while the sale waits to be sent again, a download does not count it twice on screen", async () => {
    const d = await newDevice();
    const milk = await product(d);
    await d.sync();

    await runCommand(d.db, d.ctx, "sale.create", {
      id: newId(),
      lines: [line(milk, 2000)],
      tendered: 10_000,
    });
    d.faults.dropNextResponses = 1; // the server saves the sale, but the phone never hears
    await d.sync().catch(() => undefined);
    expect((await d.db.products.get(milk))?.stock).toBe(98_000);

    // The next try comes before the sale's retry delay is over: it downloads, and the shop's
    // record of the product already includes the sale.
    await d.sync();
    expect((await d.db.products.get(milk))?.stock).toBe(98_000);
  });
});

describe("QA D1: removing the shop's copy from a device", () => {
  it("also removes the sales' and purchases' lines, which are the biggest part", async () => {
    const d = await newDevice();
    const milk = await product(d);
    await runCommand(d.db, d.ctx, "sale.create", {
      id: newId(),
      lines: [line(milk, 1000)],
      tendered: 5000,
    });
    await d.sync();
    expect(await d.db.saleItems.count()).toBeGreaterThan(0);

    await removeOfflineData(d.db);
    expect(await d.db.saleItems.count()).toBe(0);
    expect(await d.db.purchaseItems.count()).toBe(0);
    expect(await d.db.sales.count()).toBe(0);
  });

  it("is refused while something is still waiting to be sent", async () => {
    const d = await newDevice();
    await runCommand(d.db, d.ctx, "category.create", {
      id: newId(),
      name: "Unsent",
    });
    await expect(removeOfflineData(d.db)).rejects.toMatchObject({
      problem: "UNSENT",
    });
    expect(await d.db.categories.count()).toBe(1);
  });
});

describe("QA D2: going online while something waits out a retry delay", () => {
  it("sends it first instead of refusing for up to five minutes", async () => {
    const d = await newDevice();
    d.faults.offline = true;
    await runCommand(d.db, d.ctx, "category.create", {
      id: newId(),
      name: "Waiting",
    });
    await d.sync().catch(() => undefined); // fails and starts waiting

    d.faults.offline = false;
    await expect(
      drainForOnline(d.db, d.transport, d.options),
    ).resolves.toBeUndefined();
    expect(await d.db.outbox.where("status").equals("pending").count()).toBe(0);
  });
});
