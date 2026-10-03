import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/auth/permissions";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { runOnlineCommand } from "../online-commands";

let mongo: TestMongo;
let storeId: string;
let owner: string;
let cashier: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
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
  deviceId: "online-device",
});
const asOwner = () => actor(owner, "owner");
const asCashier = () => actor(cashier, "cashier");

const run = (
  who: ReturnType<typeof actor>,
  type: string,
  input: unknown,
  extra: { baseVersion?: number; operationId?: string } = {},
) =>
  runOnlineCommand(mongo, who, {
    operationId: extra.operationId ?? randomUUID(),
    type,
    input,
    baseVersion: extra.baseVersion,
  });

const col = (name: string) => mongo.db.collection(name);
const MONTH = /^\d{4}$/;

async function product(over: Record<string, unknown> = {}) {
  const id = randomUUID();
  const result = await run(asOwner(), "product.create", {
    id,
    name: "Milk",
    purchasePrice: 4000,
    sellingPrice: 5000,
    openingStock: 100_000,
    openingMovementId: randomUUID(),
    ...over,
  });
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
const sell = (
  productId: string,
  over: Record<string, unknown> = {},
  who = asOwner(),
  lineOver: Record<string, unknown> = {},
) =>
  run(who, "sale.create", {
    id: randomUUID(),
    lines: [line(productId, lineOver)],
    tendered: 1_000_000,
    ...over,
  });
const saleDoc = async (docs: Array<{ collection: string; doc: unknown }>) =>
  docs.find((d) => d.collection === "sales")?.doc as {
    id: string;
    invoiceNo: string;
  };

describe("automatic SKUs", () => {
  it("a blank SKU gets the next short number, and a typed one is kept and skipped over", async () => {
    const skuOf = async (id: string) =>
      (await col("products").findOne({ _id: id as never }))?.sku;
    expect(await skuOf(await product())).toBe("00001");
    expect(await skuOf(await product())).toBe("00002");
    expect(await skuOf(await product({ sku: "00003" }))).toBe("00003");
    // The counter would hand out 00003 next, but it is taken: it moves on.
    expect(await skuOf(await product())).toBe("00004");
    expect(await skuOf(await product({ sku: "MILK-1L" }))).toBe("MILK-1L");
  });
});

describe("sales", () => {
  it("numbers the sale for the whole shop, in order, in a form a device can never produce", async () => {
    const id = await product();
    const first = await sell(id);
    const second = await sell(id);
    if (!first.ok || !second.ok) throw new Error("sale failed");
    const a = (await saleDoc(first.docs)).invoiceNo;
    const b = (await saleDoc(second.docs)).invoiceNo;
    expect(a).toMatch(/^\d{4}-\d{5}$/);
    expect(Number(b.slice(-5)) - Number(a.slice(-5))).toBe(1);
    expect(a.slice(0, 4)).toMatch(MONTH);
    // Devices number like "A-2610-0042": different shape, so never equal.
    expect(a).not.toMatch(/^[0-9A-Z]+-\d{4}-\d{4}$/);
  });

  it("takes the cost and the listed price from the shop's records, whatever the browser says", async () => {
    const id = await product({ purchasePrice: 4000, sellingPrice: 5000 });
    const result = await sell(id, {}, asOwner(), { unitCost: 1, listPrice: 1 });
    if (!result.ok) throw new Error("sale failed");
    const sale = await col("sales").findOne({
      _id: (await saleDoc(result.docs)).id as never,
    });
    const item = ((sale?.items ?? []) as Array<Record<string, number>>)[0];
    expect(item.unitCost).toBe(4000);
    expect(item.listPrice).toBe(5000);
  });

  it("a cashier cannot hide a price change by claiming the listed price was the price they charged", async () => {
    const id = await product({ sellingPrice: 5000 });
    const before = await col("sales").countDocuments({ storeId });
    const cheated = await sell(id, {}, asCashier(), {
      unitPrice: 100,
      listPrice: 100,
    });
    expect(cheated).toMatchObject({ ok: false, status: "forbidden" });
    expect(await col("sales").countDocuments({ storeId })).toBe(before);
    // At the listed price a cashier sells normally; the owner may change a price.
    expect((await sell(id, {}, asCashier())).ok).toBe(true);
    expect((await sell(id, {}, asOwner(), { unitPrice: 4500 })).ok).toBe(true);
  });

  it("copies the buyer's name and phone from the customer, and records what they owe", async () => {
    const id = await product();
    const customer = randomUUID();
    await run(asOwner(), "customer.create", {
      id: customer,
      name: "রহিম উদ্দিন",
      phone: "01711000001",
    });
    const result = await sell(id, {
      customerId: customer,
      customerName: "someone else",
      tendered: 2000,
    });
    if (!result.ok) throw new Error("sale failed");
    const sale = await col("sales").findOne({
      _id: (await saleDoc(result.docs)).id as never,
    });
    expect(sale).toMatchObject({
      customerName: "রহিম উদ্দিন",
      customerPhone: "01711000001",
      due: 3000,
    });
    expect(
      (await col("customers").findOne({ _id: customer as never }))?.balance,
    ).toBe(3000);
    expect(sale?.searchWords).toEqual(
      expect.arrayContaining(["01711000001", "রহিম"]),
    );
  });

  it("applies once, however many times the same tap arrives, and answers the same every time", async () => {
    const id = await product();
    const operationId = randomUUID();
    const input = { id: randomUUID(), lines: [line(id)], tendered: 1_000_000 };
    const first = await run(asOwner(), "sale.create", input, { operationId });
    const again = await run(asOwner(), "sale.create", input, { operationId });
    if (!first.ok || !again.ok) throw new Error("sale failed");
    expect(first.status).toBe("applied");
    expect(again.status).toBe("duplicate");
    expect((await saleDoc(again.docs)).invoiceNo).toBe(
      (await saleDoc(first.docs)).invoiceNo,
    );
    expect(await col("sales").countDocuments({ _id: input.id as never })).toBe(
      1,
    );
    expect((await col("products").findOne({ _id: id as never }))?.stock).toBe(
      99_000,
    );
  });

  it("many sales at the same moment all get different numbers", async () => {
    const id = await product();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => sell(id)),
    );
    const numbers = results
      .map((r) => (r.ok ? r.docs.find((d) => d.collection === "sales") : null))
      .map((d) =>
        String(
          (d?.doc as unknown as { invoiceNo?: string } | undefined)?.invoiceNo,
        ),
      );
    expect(new Set(numbers).size).toBe(8);
    const seqs = numbers.map((n) => Number(n.slice(-5))).sort((x, y) => x - y);
    expect(seqs[7] - seqs[0]).toBe(7); // no gaps, no repeats
  });

  it("a product deleted a moment ago still sells, but a product that is not in the shop at all does not", async () => {
    const id = await product();
    const removed = await run(
      asOwner(),
      "product.delete",
      { id },
      { baseVersion: 1 },
    );
    expect(removed.ok).toBe(true);
    expect((await sell(id, {}, asOwner(), { unitCost: 3000 })).ok).toBe(true);
    // An id of another shop, or a made-up one: refused, nothing recorded.
    const unknown = await sell(randomUUID());
    expect(unknown).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("cancelling and returning", () => {
  it("cancels a sale from the shop's own record of it: stock and the customer's due go back", async () => {
    const id = await product();
    const customer = randomUUID();
    await run(asOwner(), "customer.create", {
      id: customer,
      name: "A",
      phone: "",
    });
    const sold = await sell(id, { customerId: customer, tendered: 0 });
    if (!sold.ok) throw new Error("sale failed");
    const saleId = (await saleDoc(sold.docs)).id;
    expect(
      (await col("customers").findOne({ _id: customer as never }))?.balance,
    ).toBe(5000);

    const voided = await run(asOwner(), "sale.void", {
      saleId,
      reason: "wrong item",
    });
    expect(voided.ok).toBe(true);
    expect((await col("products").findOne({ _id: id as never }))?.stock).toBe(
      100_000,
    );
    expect(
      (await col("customers").findOne({ _id: customer as never }))?.balance,
    ).toBe(0);
    expect(
      await run(asOwner(), "sale.void", { saleId: randomUUID(), reason: "" }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("refunds what was really paid, even if the browser claims more, and numbers the return", async () => {
    const id = await product();
    const sold = await sell(id, {}, asOwner(), { qty: 2000 });
    if (!sold.ok) throw new Error("sale failed");
    const saleId = (await saleDoc(sold.docs)).id;
    const result = await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId,
      lines: [
        {
          itemIndex: 0,
          productId: id,
          productName: "x",
          productNameBn: "",
          unit: "pcs",
          qty: 1000,
          unitPrice: 999_999,
        },
      ],
    });
    if (!result.ok) throw new Error(`return failed: ${JSON.stringify(result)}`);
    const ret = result.docs.find((d) => d.collection === "returns")
      ?.doc as unknown as { returnNo: string; total: number };
    expect(ret.total).toBe(5000);
    expect(ret.returnNo).toMatch(/^R-\d{4}-\d{5}$/);
  });

  it("refuses a return of more than was sold, and does not use up a number doing so", async () => {
    const id = await product();
    const sold = await sell(id, {}, asOwner(), { qty: 1000 });
    if (!sold.ok) throw new Error("sale failed");
    const saleId = (await saleDoc(sold.docs)).id;
    const returnOf = (qty: number) =>
      run(asOwner(), "saleReturn.create", {
        id: randomUUID(),
        saleId,
        lines: [
          {
            itemIndex: 0,
            productId: id,
            productName: "x",
            productNameBn: "",
            unit: "pcs",
            qty,
            unitPrice: 0,
          },
        ],
      });
    const counterBefore =
      (
        await col("counters").findOne({
          _id: `${storeId}:R:${await storeMonth()}` as never,
        })
      )?.seq ?? 0;
    expect(await returnOf(2000)).toMatchObject({
      ok: false,
      code: "RETURN_TOO_MUCH",
    });
    const counterAfter =
      (
        await col("counters").findOne({
          _id: `${storeId}:R:${await storeMonth()}` as never,
        })
      )?.seq ?? 0;
    expect(counterAfter).toBe(counterBefore);
    expect((await returnOf(1000)).ok).toBe(true);
  });

  it("a line that does not match the original is refused", async () => {
    const id = await product();
    const sold = await sell(id);
    if (!sold.ok) throw new Error("sale failed");
    const result = await run(asOwner(), "saleReturn.create", {
      id: randomUUID(),
      saleId: (await saleDoc(sold.docs)).id,
      lines: [
        {
          itemIndex: 5,
          productId: id,
          productName: "x",
          productNameBn: "",
          unit: "pcs",
          qty: 1,
          unitPrice: 0,
        },
      ],
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_LINE" });
  });
});

async function storeMonth() {
  const sale = await col("counters")
    .find({ _id: { $regex: `^${storeId}:S:` } as never })
    .toArray();
  return String(sale[0]?._id).split(":")[2];
}

describe("purchases", () => {
  it("numbers purchases and purchase returns in their own series", async () => {
    const id = await product();
    const bought = await run(asOwner(), "purchase.create", {
      id: randomUUID(),
      date: "2026-10-02",
      paid: 10_000_000,
      lines: [
        {
          productId: id,
          productName: "Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 5000,
          unitCost: 4000,
          discount: 0,
        },
      ],
    });
    if (!bought.ok)
      throw new Error(`purchase failed: ${JSON.stringify(bought)}`);
    const purchase = bought.docs.find((d) => d.collection === "purchases")
      ?.doc as unknown as { id: string; purchaseNo: string };
    expect(purchase.purchaseNo).toMatch(/^P-\d{4}-\d{5}$/);

    const returned = await run(asOwner(), "purchaseReturn.create", {
      id: randomUUID(),
      purchaseId: purchase.id,
      settlement: "cash",
      lines: [
        {
          itemIndex: 0,
          productId: id,
          productName: "x",
          productNameBn: "",
          unit: "pcs",
          qty: 1000,
          unitCost: 999_999,
        },
      ],
    });
    if (!returned.ok)
      throw new Error(`return failed: ${JSON.stringify(returned)}`);
    const ret = returned.docs.find((d) => d.collection === "returns")
      ?.doc as unknown as { returnNo: string; total: number };
    expect(ret.returnNo).toMatch(/^PR-\d{4}-\d{5}$/);
    expect(ret.total).toBe(4000);
  });
});

describe("edits", () => {
  it("need the version the person was looking at", async () => {
    const id = await product();
    expect(
      await run(asOwner(), "product.update", {
        id,
        changes: { name: "Fresh Milk" },
      }),
    ).toMatchObject({ ok: false, code: "BASE_VERSION_REQUIRED" });
    const done = await run(
      asOwner(),
      "product.update",
      { id, changes: { name: "Fresh Milk" } },
      { baseVersion: 1 },
    );
    expect(done.ok).toBe(true);
    expect((await col("products").findOne({ _id: id as never }))?.name).toBe(
      "Fresh Milk",
    );
    // The search words follow the name.
    expect(
      (await col("products").findOne({ _id: id as never }))?.searchWords,
    ).toContain("fresh");
  });

  it("a price changed meanwhile by someone else is reported as a conflict, not silently overwritten", async () => {
    const id = await product({ sellingPrice: 5000 });
    expect(
      (
        await run(
          asOwner(),
          "product.update",
          { id, changes: { sellingPrice: 5500 } },
          { baseVersion: 1 },
        )
      ).ok,
    ).toBe(true);
    const stale = await run(
      asOwner(),
      "product.update",
      { id, changes: { sellingPrice: 6000 } },
      { baseVersion: 1 },
    );
    expect(stale).toMatchObject({ ok: false, status: "conflict" });
    expect(
      (await col("products").findOne({ _id: id as never }))?.sellingPrice,
    ).toBe(5500);
  });

  it("settings can be set without knowing their version", async () => {
    expect(
      (
        await run(asOwner(), "setting.set", {
          key: "receipt.footer",
          value: "Thanks",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await run(asOwner(), "setting.set", {
          key: "receipt.footer",
          value: "Come again",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await col("settings").findOne({
          _id: `${storeId}:receipt.footer` as never,
        })
      )?.value,
    ).toBe("Come again");
  });
});

describe("who may do what", () => {
  it("applies the same permissions as a device: a cashier cannot add products or enter balances", async () => {
    expect(
      await run(asCashier(), "product.create", {
        id: randomUUID(),
        name: "x",
        purchasePrice: 1,
        sellingPrice: 1,
        openingMovementId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, status: "forbidden" });
    expect(
      await run(asCashier(), "party.openingBalance", {
        id: randomUUID(),
        partyType: "customer",
        partyId: randomUUID(),
        amount: 100,
      }),
    ).toMatchObject({ ok: false, status: "forbidden" });
  });

  it("refuses unknown commands and nonsense input before touching anything", async () => {
    expect(await run(asOwner(), "sale.destroyEverything", {})).toMatchObject({
      ok: false,
      status: "invalid",
      code: "UNKNOWN_COMMAND",
    });
    expect(
      await run(asOwner(), "product.create", { name: "no id" }),
    ).toMatchObject({ ok: false, status: "invalid", code: "INVALID_INPUT" });
    expect(
      await run(asOwner(), "product.create", {
        id: randomUUID(),
        name: "Free",
        purchasePrice: 0,
        sellingPrice: 0,
        openingMovementId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, status: "invalid" });
  });
});
