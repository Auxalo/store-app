import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OP_SCHEMA_VERSION } from "@/commands/definitions";
import type { OpEnvelope, PushResult } from "@/schemas/sync";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { handlePush } from "../sync/push";

let mongo: TestMongo;
let storeId: string;
let owner: string;
let cashier: string;
const deviceA = randomUUID();
const deviceB = randomUUID();

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  owner = await mongo.seedUser(storeId, "owner");
  cashier = await mongo.seedUser(storeId, "cashier");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

let clock = Date.parse("2026-10-02T11:00:00.000Z");
const tick = () => {
  clock += 1000;
  return new Date(clock).toISOString();
};

function op(
  type: string,
  payload: unknown,
  o: Partial<OpEnvelope> = {},
): OpEnvelope {
  return {
    operationId: randomUUID(),
    type,
    schemaVersion: OP_SCHEMA_VERSION,
    payload,
    actorUserId: owner,
    deviceId: deviceA,
    createdAt: tick(),
    ...o,
  };
}

async function push(
  device: string,
  ...ops: OpEnvelope[]
): Promise<PushResult[]> {
  const res = await handlePush(
    mongo,
    { storeId, deviceId: device },
    { deviceId: device, appVersion: "1.0.0", ops },
  );
  return res.results;
}

const col = (name: string) => mongo.db.collection(name);
const stockOf = async (id: string) =>
  (await col("products").findOne({ _id: id as never }))?.stock as number;
const costOf = async (id: string) =>
  (await col("products").findOne({ _id: id as never }))
    ?.purchasePrice as number;
const balanceOf = async (collection: string, id: string) =>
  (await col(collection).findOne({ _id: id as never }))?.balance as number;
const ledgerSum = async (partyId: string) =>
  (await col("ledgerEntries").find({ partyId }).toArray()).reduce(
    (s, e) => s + e.amountDelta,
    0,
  );

async function addProduct(stock = 10_000, cost = 4000) {
  const id = randomUUID();
  await push(
    deviceA,
    op("product.create", {
      id,
      name: "Milk",
      nameBn: "দুধ",
      sku: "",
      barcode: "",
      categoryId: null,
      unit: "pcs",
      purchasePrice: cost,
      sellingPrice: 5000,
      lowStockThreshold: 0,
      description: "",
      isActive: true,
      openingStock: stock,
      openingMovementId: randomUUID(),
    }),
  );
  return id;
}
async function addParty(kind: "customer" | "supplier") {
  const id = randomUUID();
  await push(
    deviceA,
    op(`${kind}.create`, {
      id,
      name: kind === "customer" ? "রহিম" : "করিম ট্রেডার্স",
    }),
  );
  return id;
}

const pLine = (productId: string, qty: number, unitCost = 4500) => ({
  productId,
  productName: "Milk",
  productNameBn: "",
  unit: "pcs",
  qty,
  unitCost,
  discount: 0,
});
function purchase(lines: unknown[], over: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    payload: {
      id,
      purchaseNo: `P-T-2610-${Math.floor(Math.random() * 9000 + 1000)}`,
      supplierId: null,
      supplierName: "",
      invoiceRef: "",
      date: "2026-10-02",
      lines,
      discount: 0,
      paid: 1_000_000,
      paymentMethod: "cash",
      notes: "",
      updateCosts: true,
      ...over,
    },
  };
}

describe("purchase.create", () => {
  it("brings stock in, reprices the product, and records the purchase with its lines", async () => {
    const milk = await addProduct(5_000, 4000);
    const p = purchase([pLine(milk, 10_000, 4500)]);
    const [result] = await push(deviceA, op("purchase.create", p.payload));
    expect(result.status).toBe("applied");
    expect(await stockOf(milk)).toBe(15_000);
    expect(await costOf(milk)).toBe(4500);
    expect(
      await col("purchases").findOne({ _id: p.id as never }),
    ).toMatchObject({
      subtotal: 45_000,
      total: 45_000,
      paid: 45_000,
      due: 0,
      itemCount: 1,
    });
    expect(
      await col("stockMovements").countDocuments({
        refId: p.id,
        type: "purchase",
        qtyDelta: 10_000,
      }),
    ).toBe(1);
    expect(
      await col("auditLogs").countDocuments({
        entityId: milk,
        action: "product.priceChange",
      }),
    ).toBe(1);
  });

  it("leaves the cost alone when asked not to update it", async () => {
    const milk = await addProduct(0, 4000);
    await push(
      deviceA,
      op(
        "purchase.create",
        purchase([pLine(milk, 1000, 9999)], { updateCosts: false }).payload,
      ),
    );
    expect(await costOf(milk)).toBe(4000);
  });

  it("adds what is unpaid to what we owe the supplier, matching the ledger", async () => {
    const milk = await addProduct();
    const supplier = await addParty("supplier");
    const p = purchase([pLine(milk, 10_000, 4500)], {
      supplierId: supplier,
      supplierName: "করিম ট্রেডার্স",
      paid: 15_000,
    });
    await push(deviceA, op("purchase.create", p.payload));
    expect(
      await col("purchases").findOne({ _id: p.id as never }),
    ).toMatchObject({ total: 45_000, paid: 15_000, due: 30_000 });
    expect(await balanceOf("suppliers", supplier)).toBe(30_000);
    expect(await ledgerSum(supplier)).toBe(30_000);
  });

  it("refuses an unpaid purchase with no supplier, and is idempotent", async () => {
    const milk = await addProduct(0);
    const [bad] = await push(
      deviceA,
      op("purchase.create", purchase([pLine(milk, 1000)], { paid: 0 }).payload),
    );
    expect(bad).toMatchObject({ status: "rejected", error: "INVALID_PAYLOAD" });

    const ok = op("purchase.create", purchase([pLine(milk, 2000)]).payload);
    await push(deviceA, ok);
    const [again] = await push(deviceA, ok);
    expect(again.status).toBe("duplicate");
    expect(await stockOf(milk)).toBe(2_000);
  });

  it("is limited to people who manage purchases", async () => {
    const milk = await addProduct();
    const [denied] = await push(
      deviceA,
      op("purchase.create", purchase([pLine(milk, 1000)]).payload, {
        actorUserId: cashier,
      }),
    );
    expect(denied).toMatchObject({ status: "rejected", error: "FORBIDDEN" });
  });
});

describe("payments and dues", () => {
  async function customerWithDue(due = 7_000) {
    const milk = await addProduct(100_000);
    const customer = await addParty("customer");
    const id = randomUUID();
    await push(
      deviceA,
      op("sale.create", {
        id,
        invoiceNo: "T-1",
        customerId: customer,
        customerName: "রহিম",
        lines: [
          {
            productId: milk,
            productName: "Milk",
            productNameBn: "",
            unit: "pcs",
            qty: 1000,
            listPrice: due,
            unitPrice: due,
            unitCost: 0,
            discount: 0,
          },
        ],
        discount: 0,
        tendered: 0,
        paymentMethod: "cash",
        notes: "",
      }),
    );
    return customer;
  }
  const collect = (
    partyId: string,
    amount: number,
    o: Partial<OpEnvelope> = {},
  ) =>
    op(
      "payment.collect",
      { id: randomUUID(), partyId, amount, method: "cash", note: "" },
      o,
    );

  it("collecting a due lowers the customer's balance and records the payment and ledger entry", async () => {
    const customer = await customerWithDue(7_000);
    expect(await balanceOf("customers", customer)).toBe(7_000);
    const [result] = await push(deviceA, collect(customer, 3_000));
    expect(result.status).toBe("applied");
    expect(await balanceOf("customers", customer)).toBe(4_000);
    expect(
      await col("payments").countDocuments({
        partyId: customer,
        amount: 3_000,
      }),
    ).toBe(1);
    expect(await ledgerSum(customer)).toBe(4_000);
  });

  it("applies a retried payment once", async () => {
    const customer = await customerWithDue(7_000);
    const once = collect(customer, 2_000);
    await push(deviceA, once);
    const [again] = await push(deviceA, once);
    expect(again.status).toBe("duplicate");
    expect(await balanceOf("customers", customer)).toBe(5_000);
  });

  it("two devices collecting at once both count", async () => {
    const customer = await customerWithDue(10_000);
    await Promise.all([
      push(deviceA, collect(customer, 3_000)),
      push(deviceB, collect(customer, 2_000, { deviceId: deviceB })),
    ]);
    expect(await balanceOf("customers", customer)).toBe(5_000);
    expect(await ledgerSum(customer)).toBe(5_000);
  });

  it("paying more than is owed leaves an advance (negative balance)", async () => {
    const customer = await customerWithDue(1_000);
    await push(deviceA, collect(customer, 4_000));
    expect(await balanceOf("customers", customer)).toBe(-3_000);
  });

  it("paying a supplier lowers what we owe them; a cashier may collect but not pay suppliers", async () => {
    const supplier = await addParty("supplier");
    const milk = await addProduct(0);
    await push(
      deviceA,
      op(
        "purchase.create",
        purchase([pLine(milk, 10_000, 4500)], {
          supplierId: supplier,
          supplierName: "X",
          paid: 0,
        }).payload,
      ),
    );
    expect(await balanceOf("suppliers", supplier)).toBe(45_000);

    const pay = (o: Partial<OpEnvelope> = {}) =>
      op(
        "payment.pay",
        {
          id: randomUUID(),
          partyId: supplier,
          amount: 20_000,
          method: "bank",
          note: "",
        },
        o,
      );
    const [denied] = await push(deviceA, pay({ actorUserId: cashier }));
    expect(denied).toMatchObject({ status: "rejected", error: "FORBIDDEN" });
    const [ok] = await push(deviceA, pay());
    expect(ok.status).toBe("applied");
    expect(await balanceOf("suppliers", supplier)).toBe(25_000);
    expect(await ledgerSum(supplier)).toBe(25_000);

    const [cashierCollects] = await push(
      deviceA,
      collect(await customerWithDue(500), 100, { actorUserId: cashier }),
    );
    expect(cashierCollects.status).toBe("applied");
  });

  it("rejects a payment to someone who does not exist", async () => {
    const [result] = await push(deviceA, collect(randomUUID(), 100));
    expect(result).toMatchObject({ status: "rejected", error: "NOT_FOUND" });
  });
});

describe("expenses", () => {
  const expense = (o: Record<string, unknown> = {}) => ({
    id: randomUUID(),
    category: "rent",
    amount: 500_000,
    description: "October",
    date: "2026-10-01",
    method: "cash",
    notes: "",
    ...o,
  });

  it("records an expense and cancels it exactly once, keeping it on record", async () => {
    const e = expense();
    const [created] = await push(deviceA, op("expense.create", e));
    expect(created.status).toBe("applied");
    const cancel = op("expense.void", { id: e.id, reason: "typo" });
    await push(deviceA, cancel);
    const [again] = await push(
      deviceA,
      op("expense.void", { id: e.id, reason: "typo" }),
    );
    expect(again.status).toBe("applied");
    expect(await col("expenses").findOne({ _id: e.id as never })).toMatchObject(
      { status: "voided", voidReason: "typo", amount: 500_000 },
    );
    expect(
      await col("auditLogs").countDocuments({
        entityId: e.id,
        action: "expense.void",
      }),
    ).toBe(1);
  });

  it("is limited to people who manage expenses", async () => {
    const [denied] = await push(
      deviceA,
      op("expense.create", expense(), { actorUserId: cashier }),
    );
    expect(denied).toMatchObject({ status: "rejected", error: "FORBIDDEN" });
  });

  it("rejects zero amounts and unknown categories", async () => {
    const [zero, unknown] = await push(
      deviceA,
      op("expense.create", expense({ amount: 0 })),
      op("expense.create", expense({ category: "yachts" })),
    );
    expect(zero.error).toBe("INVALID_PAYLOAD");
    expect(unknown.error).toBe("INVALID_PAYLOAD");
  });
});

describe("returns", () => {
  async function soldTo(customerDue: boolean) {
    const milk = await addProduct(10_000);
    const customer = customerDue ? await addParty("customer") : null;
    const id = randomUUID();
    await push(
      deviceA,
      op("sale.create", {
        id,
        invoiceNo: `T-${id.slice(0, 4)}`,
        customerId: customer,
        customerName: customer ? "রহিম" : "",
        lines: [
          {
            productId: milk,
            productName: "Milk",
            productNameBn: "",
            unit: "pcs",
            qty: 4000,
            listPrice: 5000,
            unitPrice: 5000,
            unitCost: 4000,
            discount: 0,
          },
        ],
        discount: 0,
        tendered: customerDue ? 5_000 : 1_000_000,
        paymentMethod: "cash",
        notes: "",
      }),
    );
    return { milk, customer, saleId: id };
  }
  const ret = (
    saleId: string,
    milk: string,
    qty: number,
    o: Record<string, unknown> = {},
  ) => ({
    id: randomUUID(),
    saleId,
    returnNo: `R-T-${Math.floor(Math.random() * 9000 + 1000)}`,
    customerId: null,
    lines: [
      {
        itemIndex: 0,
        productId: milk,
        productName: "Milk",
        productNameBn: "",
        unit: "pcs",
        qty,
        unitPrice: 5000,
      },
    ],
    settlement: "cash",
    restock: true,
    notes: "",
    ...o,
  });

  it("a sale return puts goods back and leaves the original sale untouched", async () => {
    const { milk, saleId } = await soldTo(false);
    expect(await stockOf(milk)).toBe(6_000);
    const r = ret(saleId, milk, 1_000);
    const [result] = await push(deviceA, op("saleReturn.create", r));
    expect(result.status).toBe("applied");
    expect(await stockOf(milk)).toBe(7_000);
    expect(await col("returns").findOne({ _id: r.id as never })).toMatchObject({
      kind: "sale",
      total: 5_000,
      refId: saleId,
      settlement: "cash",
    });
    expect(await col("sales").findOne({ _id: saleId as never })).toMatchObject({
      status: "active",
      total: 20_000,
    });
  });

  it("credit settlement lowers the customer's due; cash does not", async () => {
    const { milk, customer, saleId } = await soldTo(true); // owes 15,000
    expect(await balanceOf("customers", customer as string)).toBe(15_000);
    await push(
      deviceA,
      op(
        "saleReturn.create",
        ret(saleId, milk, 1_000, { settlement: "credit" }),
      ),
    );
    expect(await balanceOf("customers", customer as string)).toBe(10_000);
    await push(
      deviceA,
      op("saleReturn.create", ret(saleId, milk, 1_000, { settlement: "cash" })),
    );
    expect(await balanceOf("customers", customer as string)).toBe(10_000);
    expect(await ledgerSum(customer as string)).toBe(10_000);
  });

  it("damaged goods (no restock) do not go back into stock", async () => {
    const { milk, saleId } = await soldTo(false);
    await push(
      deviceA,
      op("saleReturn.create", ret(saleId, milk, 1_000, { restock: false })),
    );
    expect(await stockOf(milk)).toBe(6_000);
  });

  it("cannot return more than was sold, even across several returns or two devices", async () => {
    const { milk, saleId } = await soldTo(false); // sold 4
    const [a] = await push(
      deviceA,
      op("saleReturn.create", ret(saleId, milk, 3_000)),
    );
    expect(a.status).toBe("applied");
    const [tooMuch] = await push(
      deviceA,
      op("saleReturn.create", ret(saleId, milk, 2_000)),
    );
    expect(tooMuch).toMatchObject({
      status: "rejected",
      error: "RETURN_TOO_MUCH",
    });

    const second = await soldTo(false);
    const results = await Promise.all([
      push(
        deviceA,
        op("saleReturn.create", ret(second.saleId, second.milk, 3_000)),
      ),
      push(
        deviceB,
        op("saleReturn.create", ret(second.saleId, second.milk, 3_000), {
          deviceId: deviceB,
        }),
      ),
    ]);
    expect(results.map((r) => r[0].status).sort()).toEqual([
      "applied",
      "rejected",
    ]);
    expect(await stockOf(second.milk)).toBe(6_000 + 3_000);
  });

  it("rejects credit with no customer, a voided sale, and the wrong product for a line", async () => {
    const { milk, saleId } = await soldTo(false);
    const [noCustomer] = await push(
      deviceA,
      op(
        "saleReturn.create",
        ret(saleId, milk, 1_000, { settlement: "credit" }),
      ),
    );
    expect(noCustomer).toMatchObject({
      status: "rejected",
      error: "NO_CUSTOMER",
    });
    const [wrong] = await push(
      deviceA,
      op("saleReturn.create", ret(saleId, randomUUID(), 1_000)),
    );
    expect(wrong).toMatchObject({ status: "rejected", error: "INVALID_LINE" });

    await push(
      deviceA,
      op("sale.void", {
        saleId,
        reason: "",
        customerId: null,
        due: 0,
        lines: [{ productId: milk, qty: 1 }],
      }),
    );
    const [voided] = await push(
      deviceA,
      op("saleReturn.create", ret(saleId, milk, 1_000)),
    );
    expect(voided).toMatchObject({ status: "rejected", error: "SALE_VOIDED" });
  });

  it("is applied once however often it is retried", async () => {
    const { milk, saleId } = await soldTo(false);
    const o = op("saleReturn.create", ret(saleId, milk, 1_000));
    await push(deviceA, o);
    const [again] = await push(deviceA, o);
    expect(again.status).toBe("duplicate");
    expect(await stockOf(milk)).toBe(7_000);
  });

  it("a purchase return sends goods back and can reduce what we owe the supplier", async () => {
    const supplier = await addParty("supplier");
    const milk = await addProduct(0);
    const p = purchase([pLine(milk, 10_000, 4500)], {
      supplierId: supplier,
      supplierName: "X",
      paid: 0,
    });
    await push(deviceA, op("purchase.create", p.payload));
    expect(await balanceOf("suppliers", supplier)).toBe(45_000);

    const r = {
      id: randomUUID(),
      purchaseId: p.id,
      returnNo: "PR-T-1",
      supplierId: supplier,
      lines: [
        {
          itemIndex: 0,
          productId: milk,
          productName: "Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 2_000,
          unitCost: 4500,
        },
      ],
      settlement: "credit",
      notes: "",
    };
    const [result] = await push(deviceA, op("purchaseReturn.create", r));
    expect(result.status).toBe("applied");
    expect(await stockOf(milk)).toBe(8_000);
    expect(await balanceOf("suppliers", supplier)).toBe(36_000);
    expect(await ledgerSum(supplier)).toBe(36_000);

    const [tooMuch] = await push(
      deviceA,
      op("purchaseReturn.create", {
        ...r,
        id: randomUUID(),
        lines: [{ ...r.lines[0], qty: 9_000 }],
      }),
    );
    expect(tooMuch).toMatchObject({
      status: "rejected",
      error: "RETURN_TOO_MUCH",
    });
  });
});
