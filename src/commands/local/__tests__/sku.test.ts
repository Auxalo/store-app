import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { StoreDB } from "@/db/local/db";
import { setMeta } from "@/db/local/meta";
import { newId } from "@/lib/ids";
import { runCommand } from "../run";
import { claimSku, peekSku } from "../sku";

const ctx = (deviceId: string) => ({
  storeId: "store-1",
  actorUserId: "owner-1",
  role: "owner" as const,
  deviceId,
});

async function device(code = "A") {
  const db = new StoreDB(`sku-${newId()}`);
  const deviceId = newId();
  await setMeta(db, "deviceCode", code);
  return { db, deviceId };
}

const create = (
  db: StoreDB,
  deviceId: string,
  extra: Record<string, unknown> = {},
) =>
  runCommand(db, ctx(deviceId), "product.create", {
    id: newId(),
    name: "Milk",
    purchasePrice: 4000,
    sellingPrice: 5000,
    openingMovementId: newId(),
    ...extra,
  });

describe("automatic SKUs", () => {
  it("gives a product with no SKU the next short number of this device", async () => {
    const { db, deviceId } = await device("A");
    expect(await peekSku(db, deviceId)).toBe("A0001");
    await create(db, deviceId);
    await create(db, deviceId);
    const skus = (await db.products.toArray()).map((p) => p.sku).sort();
    expect(skus).toEqual(["A0001", "A0002"]);
    expect(await peekSku(db, deviceId)).toBe("A0003");
  });

  it("queues the generated SKU, so the server gets the same one", async () => {
    const { db, deviceId } = await device("B");
    await create(db, deviceId);
    const op = await db.outbox.toCollection().first();
    expect((op?.payload as { sku?: string } | undefined)?.sku).toBe("B0001");
  });

  it("keeps a SKU typed by hand, and never issues one already in use", async () => {
    const { db, deviceId } = await device("A");
    await create(db, deviceId, { sku: "MILK-1L" });
    await create(db, deviceId, { sku: "A0001" }); // typed in this device's own series
    await create(db, deviceId);
    const skus = (await db.products.toArray()).map((p) => p.sku).sort();
    expect(skus).toEqual(["A0001", "A0002", "MILK-1L"]);
  });

  it("skips numbers taken by products that arrived from other devices", async () => {
    const { db, deviceId } = await device("A");
    await create(db, deviceId, { sku: "A0001" });
    await setMeta(db, "skuSeq", 0); // e.g. the counter was reset, but the product exists
    expect(await claimSku(db, deviceId, "")).toBe("A0002");
  });

  it("two devices offline can never produce the same SKU", async () => {
    const a = await device("A");
    const b = await device("B");
    await create(a.db, a.deviceId);
    await create(b.db, b.deviceId);
    const [skuA] = (await a.db.products.toArray()).map((p) => p.sku);
    const [skuB] = (await b.db.products.toArray()).map((p) => p.sku);
    expect(skuA).not.toBe(skuB);
  });
});

describe("product prices are required", () => {
  it("refuses a new product without a purchase or selling price, or with a zero price", async () => {
    const { db, deviceId } = await device();
    await expect(
      runCommand(db, ctx(deviceId), "product.create", {
        id: newId(),
        name: "Milk",
        openingMovementId: newId(),
      }),
    ).rejects.toThrow();
    await expect(create(db, deviceId, { purchasePrice: 0 })).rejects.toThrow();
    await expect(create(db, deviceId, { sellingPrice: 0 })).rejects.toThrow();
    expect(await db.products.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("an edit cannot set a price to zero, but other edits still work", async () => {
    const { db, deviceId } = await device();
    await create(db, deviceId);
    const [product] = await db.products.toArray();
    await expect(
      runCommand(db, ctx(deviceId), "product.update", {
        id: product.id,
        changes: { sellingPrice: 0 },
      }),
    ).rejects.toThrow();
    await runCommand(db, ctx(deviceId), "product.update", {
      id: product.id,
      changes: { name: "Fresh Milk" },
    });
    expect((await db.products.get(product.id))?.name).toBe("Fresh Milk");
  });
});
