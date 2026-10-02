import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OP_SCHEMA_VERSION } from "@/commands/definitions";
import type { OpEnvelope, PushResult } from "@/schemas/sync";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { handlePull } from "../sync/pull";
import { handlePush } from "../sync/push";

let mongo: TestMongo;
let storeId: string;
let owner: string;
let manager: string;
let cashier: string;
const deviceA = randomUUID();
const deviceB = randomUUID();

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  await mongo.enableAudit(storeId);
  owner = await mongo.seedUser(storeId, "owner");
  manager = await mongo.seedUser(storeId, "manager");
  cashier = await mongo.seedUser(storeId, "cashier");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

let clock = Date.parse("2026-10-02T09:00:00.000Z");
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

const product = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: "Fresh Milk",
  nameBn: "ফ্রেশ দুধ",
  sku: "",
  barcode: "",
  categoryId: null,
  unit: "pcs",
  purchasePrice: 4000,
  sellingPrice: 5000,
  lowStockThreshold: 0,
  description: "",
  isActive: true,
  openingStock: 0,
  openingMovementId: randomUUID(),
  ...extra,
});

const adjust = (
  productId: string,
  qtyDelta: number,
  o: Partial<OpEnvelope> = {},
  type = "adjustment",
) =>
  op(
    "stock.adjust",
    { productId, movementId: randomUUID(), type, qtyDelta, note: "" },
    o,
  );

const stockOf = async (id: string) =>
  (await mongo.db.collection("products").findOne({ _id: id as never }))
    ?.stock as number;

describe("product.create", () => {
  it("creates the product with its opening stock as a ledger movement", async () => {
    const id = randomUUID();
    const p = product(id, { openingStock: 12_000 });
    const [result] = await push(deviceA, op("product.create", p));
    expect(result.status).toBe("applied");

    const docs = result.docs ?? [];
    expect(docs.map((d) => d.collection)).toEqual([
      "products",
      "stockMovements",
    ]);
    expect(docs[0].doc).toMatchObject({
      id,
      stock: 12_000,
      version: 1,
      sellingPrice: 5000,
      nameBn: "ফ্রেশ দুধ",
    });
    expect(docs[1].doc).toMatchObject({
      productId: id,
      type: "opening",
      qtyDelta: 12_000,
    });
    expect(docs[1].doc.syncSeq).toBe(docs[0].doc.syncSeq + 1);
  });

  it("writes no movement when there is no opening stock", async () => {
    const [result] = await push(
      deviceA,
      op("product.create", product(randomUUID())),
    );
    expect(result.docs?.map((d) => d.collection)).toEqual(["products"]);
  });

  it("only owners and managers may create products", async () => {
    const [denied] = await push(
      deviceA,
      op("product.create", product(randomUUID()), { actorUserId: cashier }),
    );
    expect(denied).toMatchObject({ status: "rejected", error: "FORBIDDEN" });
    const [ok] = await push(
      deviceA,
      op("product.create", product(randomUUID()), { actorUserId: manager }),
    );
    expect(ok.status).toBe("applied");
  });
});

describe("stock ledger", () => {
  it("moves stock by the delta and records the movement", async () => {
    const id = randomUUID();
    await push(
      deviceA,
      op("product.create", product(id, { openingStock: 10_000 })),
    );
    const [result] = await push(deviceA, adjust(id, -3_000, {}, "damage"));
    expect(result.status).toBe("applied");
    expect(await stockOf(id)).toBe(7_000);
    expect(
      await mongo.db
        .collection("stockMovements")
        .countDocuments({ productId: id, type: "damage", qtyDelta: -3_000 }),
    ).toBe(1);
  });

  it("applies a retried adjustment exactly once", async () => {
    const id = randomUUID();
    await push(
      deviceA,
      op("product.create", product(id, { openingStock: 5_000 })),
    );
    const once = adjust(id, 2_000);
    await push(deviceA, once);
    const [again] = await push(deviceA, once);
    expect(again.status).toBe("duplicate");
    expect(await stockOf(id)).toBe(7_000);
  });

  it("does not double-count the same movement under a different operation id", async () => {
    const id = randomUUID();
    await push(
      deviceA,
      op("product.create", product(id, { openingStock: 1_000 })),
    );
    const movementId = randomUUID();
    const body = {
      productId: id,
      movementId,
      type: "adjustment",
      qtyDelta: 500,
      note: "",
    };
    await push(deviceA, op("stock.adjust", body));
    const [second] = await push(deviceA, op("stock.adjust", body));
    expect(second.status).toBe("applied");
    expect(await stockOf(id)).toBe(1_500);
  });

  it("adds up adjustments made by two devices, in any order", async () => {
    const id = randomUUID();
    await push(
      deviceA,
      op("product.create", product(id, { openingStock: 100_000 })),
    );
    await Promise.all([
      push(deviceA, adjust(id, 5_000)),
      push(deviceB, adjust(id, -2_000, { deviceId: deviceB })),
      push(deviceB, adjust(id, -7_000, { deviceId: deviceB })),
    ]);
    expect(await stockOf(id)).toBe(100_000 + 5_000 - 2_000 - 7_000);
  });

  it("lets stock go negative instead of refusing a sale of the last item twice", async () => {
    const id = randomUUID();
    await push(
      deviceA,
      op("product.create", product(id, { openingStock: 1_000 })),
    );
    await push(deviceA, adjust(id, -1_000));
    await push(deviceB, adjust(id, -1_000, { deviceId: deviceB }));
    expect(await stockOf(id)).toBe(-1_000);
  });

  it("rejects adjusting a product that does not exist or was deleted", async () => {
    const [missing] = await push(deviceA, adjust(randomUUID(), 1_000));
    expect(missing).toMatchObject({ status: "rejected", error: "NOT_FOUND" });

    const id = randomUUID();
    await push(deviceA, op("product.create", product(id)));
    await push(deviceA, op("product.delete", { id, baseVersion: 1 }));
    const [deleted] = await push(deviceA, adjust(id, 1_000));
    expect(deleted).toMatchObject({ status: "rejected", error: "DELETED" });
  });

  it("only users who may adjust stock can do it", async () => {
    const id = randomUUID();
    await push(deviceA, op("product.create", product(id)));
    const [denied] = await push(
      deviceA,
      adjust(id, 1_000, { actorUserId: cashier }),
    );
    expect(denied).toMatchObject({ status: "rejected", error: "FORBIDDEN" });
  });

  it("exposes the new stock and movements to other devices through pull", async () => {
    const s = await mongo.seedStore("Pull stock");
    const u = await mongo.seedUser(s, "owner");
    const id = randomUUID();
    await handlePush(
      mongo,
      { storeId: s, deviceId: deviceA },
      {
        deviceId: deviceA,
        appVersion: "1.0.0",
        ops: [
          op("product.create", product(id, { openingStock: 4_000 }), {
            actorUserId: u,
          }),
          adjust(id, 1_000, { actorUserId: u }),
        ],
      },
    );
    const page = await handlePull(mongo.db, s, 0);
    expect(page.changes.products.at(-1)).toMatchObject({
      id,
      stock: 5_000,
      version: 2,
    });
    expect(page.changes.stockMovements.map((m) => m.qtyDelta).sort()).toEqual([
      1_000, 4_000,
    ]);
  });
});

describe("product edits", () => {
  it("merges edits to different fields and keeps stock out of the way", async () => {
    const id = randomUUID();
    await push(
      deviceA,
      op("product.create", product(id, { openingStock: 8_000 })),
    );
    // Device A edits the name while device B sells (stock changes) and edits the description.
    const [a] = await push(
      deviceA,
      op("product.update", {
        id,
        baseVersion: 1,
        changes: { name: "Milk 1L" },
      }),
    );
    await push(deviceB, adjust(id, -1_000, { deviceId: deviceB }));
    const [b] = await push(
      deviceB,
      op(
        "product.update",
        { id, baseVersion: 1, changes: { description: "Cold" } },
        { deviceId: deviceB },
      ),
    );
    expect([a.status, b.status]).toEqual(["applied", "applied"]);
    expect(b.docs?.[0]?.doc).toMatchObject({
      name: "Milk 1L",
      description: "Cold",
      stock: 7_000,
    });
  });

  it("flags a concurrent price change as a conflict instead of silently picking one", async () => {
    const id = randomUUID();
    await push(deviceA, op("product.create", product(id)));
    const [first] = await push(
      deviceA,
      op("product.update", {
        id,
        baseVersion: 1,
        changes: { sellingPrice: 5500 },
      }),
    );
    const [second] = await push(
      deviceB,
      op(
        "product.update",
        { id, baseVersion: 1, changes: { sellingPrice: 6000 } },
        { deviceId: deviceB },
      ),
    );
    expect(first.status).toBe("applied");
    expect(second.status).toBe("conflict");
    expect(second.docs?.[0]?.doc).toMatchObject({ sellingPrice: 5500 });
    // Nothing was written for the conflicting edit.
    expect(
      (await mongo.db.collection("products").findOne({ _id: id as never }))
        ?.sellingPrice,
    ).toBe(5500);
  });

  it("does not treat an unrelated price edit as a conflict", async () => {
    const id = randomUUID();
    await push(deviceA, op("product.create", product(id)));
    await push(
      deviceA,
      op("product.update", {
        id,
        baseVersion: 1,
        changes: { sellingPrice: 5200 },
      }),
    );
    const [other] = await push(
      deviceB,
      op(
        "product.update",
        { id, baseVersion: 1, changes: { purchasePrice: 4100 } },
        { deviceId: deviceB },
      ),
    );
    expect(other.status).toBe("applied");
  });
});

describe("audit trail", () => {
  it("records price changes and stock adjustments with old and new values", async () => {
    const id = randomUUID();
    await push(
      deviceA,
      op("product.create", product(id, { openingStock: 2_000 })),
    );
    await push(
      deviceA,
      op("product.update", {
        id,
        baseVersion: 1,
        changes: { sellingPrice: 5100 },
      }),
    );
    await push(deviceA, adjust(id, -500, {}, "correction"));

    const logs = await mongo.db
      .collection("auditLogs")
      .find({ entityId: id })
      .sort({ at: 1 })
      .toArray();
    expect(logs.map((l) => l.action)).toEqual([
      "product.priceChange",
      "stock.adjust",
    ]);
    expect(logs[0]).toMatchObject({
      oldValue: { sellingPrice: 5000 },
      newValue: { sellingPrice: 5100 },
      userId: owner,
    });
    expect(logs[1]).toMatchObject({
      oldValue: { stock: 2_000 },
      newValue: { stock: 1_500, type: "correction" },
    });
  });

  it("writes nothing when the store has the audit log switched off (the default)", async () => {
    const quietStore = await mongo.seedStore("Quiet Store");
    const quietOwner = await mongo.seedUser(quietStore, "owner");
    const device = randomUUID();
    const id = randomUUID();
    const run = (o: OpEnvelope) =>
      handlePush(
        mongo,
        { storeId: quietStore, deviceId: device },
        { deviceId: device, appVersion: "1.0.0", ops: [o] },
      );
    const as = { actorUserId: quietOwner, deviceId: device };
    await run(op("product.create", product(id, { openingStock: 2_000 }), as));
    await run(
      op(
        "product.update",
        { id, baseVersion: 1, changes: { sellingPrice: 5100 } },
        as,
      ),
    );
    await run(adjust(id, -500, as));

    expect(
      (await mongo.db.collection("products").findOne({ _id: id as never }))
        ?.stock,
    ).toBe(1_500);
    expect(
      await mongo.db
        .collection("auditLogs")
        .countDocuments({ storeId: quietStore }),
    ).toBe(0);
  });

  it("deletes audit rows automatically after 7 days", async () => {
    const indexes = await mongo.db.collection("auditLogs").indexes();
    const ttl = indexes.find((i) => i.key.recordedAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(7 * 24 * 60 * 60);
  });
});
