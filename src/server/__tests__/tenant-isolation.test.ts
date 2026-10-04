import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseListParams, RESOURCES } from "@/data/spec";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { shopBillingView, submitPayment } from "../billing";
import { clearStoreCaches } from "../cache";
import {
  getRecord,
  listResource,
  lookupProduct,
  stockSummary,
  totalsOf,
  type Viewer,
} from "../data/service";
import { runOnlineCommand } from "../online-commands";
import { serverSummary } from "../reports";
import { handlePull } from "../sync/pull";

vi.mock("server-only", () => ({}));

/**
 * Two shops share one database. Whatever shop A does, nothing it reads or writes may be able to
 * reach shop B's records. This test makes the isolation checkable and keeps it from drifting:
 *
 *  1. It watches every database command that shop A's reads and saves send, and fails if a command
 *     on a shop's data is not tied to that shop (its filter must name the shop, or look up one
 *     record by id in a place where the shop is checked straight after, listed below with why).
 *  2. It tries to reach shop B's records with shop B's real ids, through every kind of save, and
 *     requires that every attempt is refused or finds nothing, and that shop B is unchanged.
 */

let mongo: TestMongo;
let shopA: string;
let shopB: string;
let ownerA: string;
let ownerB: string;

interface Seen {
  name: string;
  collection: string;
  filters: unknown[];
}
const seen: Seen[] = [];

/** The collections that hold a shop's data (everything except accounts, sessions and devices). */
const TENANT = new Set([
  "products",
  "customers",
  "suppliers",
  "sales",
  "purchases",
  "expenses",
  "payments",
  "returns",
  "stockMovements",
  "ledgerEntries",
  "categories",
  "settings",
  "counters",
  "appliedOps",
  "auditLogs",
  "stores",
  "billingPayments",
]);

/**
 * Looking one record up by its id alone is allowed in exactly these places, because the code
 * compares the record's shop straight after (a record of another shop is treated as not found or as
 * an id clash), so nothing of another shop is ever used or changed.
 */
const ID_LOOKUP_THEN_SHOP_CHECK = new Set([
  "sales", // saleCreate: "does this id already exist?" then storeId compared
  "purchases", // purchaseCreate, same
  "payments", // paymentCreate, same
  "expenses", // expenseCreate, same
  "returns", // return create, same
  "products", // product.create id clash, same
  "customers", // customer.create id clash, same
  "suppliers", // supplier.create id clash, same
  "categories", // category.create id clash, same
  "stores", // the shop's own record: the id IS the shop
  "ledgerEntries", // party.openingBalance: "already applied?" then storeId compared
  "stockMovements", // stock.adjust: "already applied?" then storeId compared (another shop's id is a clash)
]);

const names = (filter: unknown) => JSON.stringify(filter ?? {});

function tiedToShop(
  collection: string,
  filter: unknown,
  shop: string,
): boolean {
  const text = names(filter);
  if (text.includes('"storeId"') || text.includes(shop)) return true;
  // A lookup by id alone where the shop is compared straight after.
  const keys = Object.keys((filter ?? {}) as Record<string, unknown>);
  return (
    keys.length > 0 &&
    keys.every((k) => k === "_id") &&
    ID_LOOKUP_THEN_SHOP_CHECK.has(collection)
  );
}

beforeAll(async () => {
  mongo = await startMongo();
  mongo.client.on("commandStarted", (event) => {
    const c = event.command as Record<string, unknown>;
    const name = event.commandName;
    const pick = (key: string) => String(c[key] ?? "");
    let collection = "";
    let filters: unknown[] = [];
    if (name === "find") {
      collection = pick("find");
      filters = [c.filter];
    } else if (name === "aggregate") {
      collection = pick("aggregate");
      const stages = (c.pipeline as Array<Record<string, unknown>>) ?? [];
      filters = stages.filter((s) => s.$match).map((s) => s.$match);
      if (filters.length === 0) filters = [{}];
    } else if (name === "update") {
      collection = pick("update");
      filters = ((c.updates as Array<{ q: unknown }>) ?? []).map((u) => u.q);
    } else if (name === "delete") {
      collection = pick("delete");
      filters = ((c.deletes as Array<{ q: unknown }>) ?? []).map((d) => d.q);
    } else if (name === "findAndModify") {
      collection = pick("findAndModify");
      filters = [c.query];
    } else if (name === "count" || name === "distinct") {
      collection = pick(name);
      filters = [c.query];
    } else if (name === "insert") {
      collection = pick("insert");
      filters = ((c.documents as Array<Record<string, unknown>>) ?? []).map(
        (d) => ({ storeId: d.storeId, _id: d._id }),
      );
    } else return;
    seen.push({ name, collection, filters });
  });

  shopA = await mongo.seedStore("Shop A");
  shopB = await mongo.seedStore("Shop B");
  ownerA = await mongo.seedUser(shopA, "owner");
  ownerB = await mongo.seedUser(shopB, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const actor = (shop: string, owner: string) => ({
  id: owner,
  role: "owner" as const,
  storeId: shop,
  deviceId: `dev-${shop.slice(0, 4)}`,
});
const asA = () => actor(shopA, ownerA);
const asB = () => actor(shopB, ownerB);

const run = (
  who: ReturnType<typeof actor>,
  type: string,
  input: unknown,
  baseVersion?: number,
) =>
  runOnlineCommand(mongo, who, {
    operationId: randomUUID(),
    type,
    input,
    baseVersion,
  });

const line = (productId: string, name: string, qty = 1000) => ({
  productId,
  productName: name,
  productNameBn: "",
  unit: "pcs",
  qty,
  listPrice: 5000,
  unitPrice: 5000,
  unitCost: 0,
  discount: 0,
});

interface ShopData {
  product: string;
  customer: string;
  supplier: string;
  sale: string;
  purchase: string;
  expense: string;
  barcode: string;
}

/** A shop with one of everything. */
async function stock(
  who: ReturnType<typeof actor>,
  tag: string,
): Promise<ShopData> {
  const product = randomUUID();
  const customer = randomUUID();
  const supplier = randomUUID();
  const barcode = `${tag}-BAR`;
  const ok = (r: { ok: boolean }) => expect(r.ok).toBe(true);
  ok(
    await run(who, "product.create", {
      id: product,
      name: `${tag} Milk`,
      purchasePrice: 4000,
      sellingPrice: 5000,
      openingStock: 100_000,
      openingMovementId: randomUUID(),
      sku: `${tag}-SKU`,
      barcode,
    }),
  );
  ok(
    await run(who, "customer.create", {
      id: customer,
      name: `${tag} Customer`,
      phone: "01711000000",
    }),
  );
  ok(
    await run(who, "supplier.create", {
      id: supplier,
      name: `${tag} Supplier`,
    }),
  );
  const sale = randomUUID();
  ok(
    await run(who, "sale.create", {
      id: sale,
      lines: [line(product, `${tag} Milk`)],
      customerId: customer,
      customerName: "",
      tendered: 2000,
      paymentMethod: "cash",
    }),
  );
  const purchase = randomUUID();
  ok(
    await run(who, "purchase.create", {
      id: purchase,
      supplierId: supplier,
      supplierName: `${tag} Supplier`,
      date: "2026-10-02",
      lines: [
        {
          productId: product,
          productName: `${tag} Milk`,
          productNameBn: "",
          unit: "pcs",
          qty: 5000,
          unitCost: 4000,
          discount: 0,
        },
      ],
      discount: 0,
      paid: 1000,
      paymentMethod: "cash",
    }),
  );
  const expense = randomUUID();
  ok(
    await run(who, "expense.create", {
      id: expense,
      category: "rent",
      amount: 1000,
      date: "2026-10-02",
      description: `${tag} rent`,
    }),
  );
  return { product, customer, supplier, sale, purchase, expense, barcode };
}

let a: ShopData;
let b: ShopData;

/** Everything shop B holds, as text, to see that nothing of it changes or shows up elsewhere. */
async function snapshotOf(shop: string) {
  const out: Record<string, unknown[]> = {};
  for (const name of TENANT) {
    if (name === "stores") continue;
    out[name] = await mongo.db
      .collection(name)
      .find({ storeId: shop } as never)
      .sort({ _id: 1 })
      .toArray();
  }
  out.stores = await mongo.db
    .collection("stores")
    .find({ _id: shop as never })
    .toArray();
  return JSON.stringify(out);
}

describe("two shops in one database", () => {
  beforeAll(async () => {
    a = await stock(asA(), "AAA");
    b = await stock(asB(), "BBB");
  }, 120_000);

  it("everything shop A reads or saves is tied to shop A", async () => {
    seen.length = 0;
    const viewer: Viewer = {
      storeId: shopA,
      canSeeCost: true,
      timeZone: "Asia/Dhaka",
    };
    const responses: unknown[] = [];

    // Every list, in several shapes, and the totals behind them.
    for (const resource of RESOURCES) {
      for (const input of [{}, { q: "AAA" }, { q: "BBB" }]) {
        const params = parseListParams(resource, input as never);
        responses.push(
          await listResource(mongo.db, resource, params as never, viewer),
        );
        responses.push(
          await totalsOf(mongo.db, resource, params as never, viewer),
        );
      }
    }
    // One record of each kind, a code lookup, the reports, and what a device would pull.
    for (const [resource, id] of [
      ["products", a.product],
      ["customers", a.customer],
      ["suppliers", a.supplier],
      ["sales", a.sale],
      ["purchases", a.purchase],
    ] as const)
      responses.push(await getRecord(mongo.db, resource, id, viewer));
    responses.push(await lookupProduct(mongo.db, "AAA-BAR", viewer));
    responses.push(await stockSummary(mongo.db, viewer));
    responses.push(
      await serverSummary(mongo.db, shopA, {
        from: "2026-01-01",
        to: "2026-12-31",
      }),
    );
    responses.push(await handlePull(mongo.db, shopA, 0));

    // Saves of every kind.
    const sold = randomUUID();
    responses.push(
      await run(asA(), "sale.create", {
        id: sold,
        lines: [line(a.product, "AAA Milk", 2000)],
        customerId: a.customer,
        customerName: "",
        tendered: 0,
        paymentMethod: "cash",
      }),
    );
    responses.push(
      await run(asA(), "saleReturn.create", {
        id: randomUUID(),
        saleId: a.sale,
        lines: [
          {
            itemIndex: 0,
            productId: a.product,
            productName: "AAA Milk",
            productNameBn: "",
            unit: "pcs",
            qty: 1000,
            unitPrice: 5000,
          },
        ],
        settlement: "cash",
      }),
    );
    responses.push(
      await run(asA(), "sale.void", { saleId: sold, reason: "test" }),
    );
    responses.push(
      await run(asA(), "payment.collect", {
        id: randomUUID(),
        partyId: a.customer,
        amount: 500,
        method: "cash",
        note: "",
      }),
    );
    responses.push(
      await run(asA(), "payment.pay", {
        id: randomUUID(),
        partyId: a.supplier,
        amount: 500,
        method: "cash",
        note: "",
      }),
    );
    responses.push(
      await run(asA(), "party.openingBalance", {
        id: randomUUID(),
        partyType: "customer",
        partyId: a.customer,
        amount: 100,
        note: "",
      }),
    );
    responses.push(
      await run(asA(), "stock.adjust", {
        productId: a.product,
        movementId: randomUUID(),
        type: "adjustment",
        qtyDelta: 1000,
        note: "",
      }),
    );
    responses.push(
      await run(asA(), "expense.void", { id: a.expense, reason: "x" }),
    );
    responses.push(
      await run(
        asA(),
        "product.update",
        { id: a.product, changes: { name: "AAA Milk 2" } },
        1,
      ),
    );
    responses.push(
      await run(
        asA(),
        "customer.update",
        { id: a.customer, changes: { name: "AAA C2" } },
        1,
      ),
    );
    responses.push(
      await run(asA(), "setting.set", {
        key: "receipt.footer",
        value: "thanks",
      }),
    );

    // 1. Every command on a shop's data names the shop.
    const loose: string[] = [];
    for (const s of seen) {
      if (!TENANT.has(s.collection)) continue;
      for (const filter of s.filters)
        if (!tiedToShop(s.collection, filter, shopA))
          loose.push(
            `${s.name} on ${s.collection}: ${names(filter).slice(0, 120)}`,
          );
    }
    expect(loose, "database commands not tied to the shop").toEqual([]);

    // 2. Nothing of shop B is in anything shop A was told.
    const everything = JSON.stringify(responses);
    for (const mark of [
      "BBB",
      b.product,
      b.customer,
      b.supplier,
      b.sale,
      b.purchase,
      b.expense,
    ])
      expect(everything).not.toContain(mark);
  }, 60_000);

  it("shop A's billing page and payments are tied to shop A and show nothing of shop B", async () => {
    const paid = {
      mode: "paid",
      planId: "m1",
      paidOnce: true,
      paidUntil: new Date("2030-01-01T00:00:00Z"),
      lockAt: new Date("2030-01-04T00:00:00Z"),
    };
    for (const shop of [shopA, shopB])
      await mongo.db
        .collection<{ _id: string }>("stores")
        .updateOne({ _id: shop }, { $set: { billing: paid } });
    clearStoreCaches();
    const payment = (trxId: string) => ({
      method: "bkash" as const,
      trxId,
      sender: "01711000001",
      amount: 50000,
      planId: "m1",
    });
    await submitPayment(
      mongo.db,
      shopB,
      { id: ownerB, name: "B" },
      payment("BBBTRX0001"),
    );

    seen.length = 0;
    const responses = [
      await submitPayment(
        mongo.db,
        shopA,
        { id: ownerA, name: "A" },
        payment("AAATRX0001"),
      ),
      await shopBillingView(mongo.db, shopA, true),
    ];
    const loose = seen
      .filter((s) => TENANT.has(s.collection))
      .flatMap((s) =>
        s.filters
          .filter((f) => !tiedToShop(s.collection, f, shopA))
          .map(
            (f) => `${s.name} on ${s.collection}: ${names(f).slice(0, 120)}`,
          ),
      );
    expect(loose, "database commands not tied to the shop").toEqual([]);
    const everything = JSON.stringify(responses);
    expect(everything).toContain("AAATRX0001");
    expect(everything).not.toContain("BBBTRX0001");
    expect(everything).not.toContain(shopB);
  }, 60_000);

  it("shop A cannot reach shop B's records with their real ids", async () => {
    const before = await snapshotOf(shopB);
    const viewer: Viewer = { storeId: shopA, canSeeCost: true };
    const bMovement = String(
      (
        await mongo.db
          .collection("stockMovements")
          .findOne({ storeId: shopB } as never)
      )?._id,
    );

    // Reading.
    expect(await getRecord(mongo.db, "products", b.product, viewer)).toBeNull();
    expect(
      await getRecord(mongo.db, "customers", b.customer, viewer),
    ).toBeNull();
    expect(await getRecord(mongo.db, "sales", b.sale, viewer)).toBeNull();
    expect(
      await getRecord(mongo.db, "purchases", b.purchase, viewer),
    ).toBeNull();
    expect(await lookupProduct(mongo.db, b.barcode, viewer)).toBeNull();
    expect(
      JSON.stringify(
        await listResource(
          mongo.db,
          "products",
          parseListParams("products", { q: b.barcode }) as never,
          viewer,
        ),
      ),
    ).not.toContain("BBB");

    // Saving, using shop B's ids as if they were shop A's.
    const attempts: Array<[string, string, unknown, number?]> = [
      ["sale.void of their sale", "sale.void", { saleId: b.sale, reason: "x" }],
      [
        "a return of their sale",
        "saleReturn.create",
        {
          id: randomUUID(),
          saleId: b.sale,
          lines: [
            {
              itemIndex: 0,
              productId: b.product,
              productName: "x",
              productNameBn: "",
              unit: "pcs",
              qty: 1000,
              unitPrice: 5000,
            },
          ],
          settlement: "cash",
        },
      ],
      [
        "selling to their customer",
        "sale.create",
        {
          id: randomUUID(),
          lines: [line(a.product, "AAA Milk")],
          customerId: b.customer,
          customerName: "",
          tendered: 0,
          paymentMethod: "cash",
        },
      ],
      [
        "collecting from their customer",
        "payment.collect",
        {
          id: randomUUID(),
          partyId: b.customer,
          amount: 100,
          method: "cash",
          note: "",
        },
      ],
      [
        "paying their supplier",
        "payment.pay",
        {
          id: randomUUID(),
          partyId: b.supplier,
          amount: 100,
          method: "cash",
          note: "",
        },
      ],
      [
        "an opening balance on their customer",
        "party.openingBalance",
        {
          id: randomUUID(),
          partyType: "customer",
          partyId: b.customer,
          amount: 100,
          note: "",
        },
      ],
      [
        "adjusting their stock",
        "stock.adjust",
        {
          productId: b.product,
          movementId: randomUUID(),
          type: "adjustment",
          qtyDelta: 5000,
          note: "",
        },
      ],
      [
        "editing their product",
        "product.update",
        { id: b.product, changes: { name: "hacked" } },
        1,
      ],
      ["deleting their product", "product.delete", { id: b.product }, 1],
      [
        "editing their customer",
        "customer.update",
        { id: b.customer, changes: { name: "hacked" } },
        1,
      ],
      ["deleting their supplier", "supplier.delete", { id: b.supplier }, 1],
      ["voiding their expense", "expense.void", { id: b.expense, reason: "x" }],
      [
        "returning their purchase",
        "purchaseReturn.create",
        {
          id: randomUUID(),
          purchaseId: b.purchase,
          lines: [
            {
              itemIndex: 0,
              productId: b.product,
              productName: "x",
              productNameBn: "",
              unit: "pcs",
              qty: 1000,
              unitCost: 4000,
            },
          ],
          settlement: "cash",
        },
      ],
      [
        "reusing their sale's id",
        "sale.create",
        {
          id: b.sale,
          lines: [line(a.product, "AAA Milk")],
          customerName: "",
          tendered: 5000,
          paymentMethod: "cash",
        },
      ],
      [
        "reusing their stock movement's id",
        "stock.adjust",
        {
          productId: a.product,
          movementId: bMovement,
          type: "adjustment",
          qtyDelta: 1000,
          note: "",
        },
      ],
      [
        "reusing their product's id",
        "product.create",
        {
          id: b.product,
          name: "Mine",
          purchasePrice: 1,
          sellingPrice: 2,
          openingStock: 0,
          openingMovementId: randomUUID(),
        },
      ],
    ];
    for (const [label, type, input, base] of attempts) {
      const result = await run(asA(), type, input, base);
      expect(result.ok, `${label} must not be accepted`).toBe(false);
    }

    // Selling their product from shop A is not refused (an unknown product is recorded as sold, as
    // for a deleted one), but it cannot move THEIR stock or show THEIR data.
    await run(asA(), "sale.create", {
      id: randomUUID(),
      lines: [line(b.product, "x")],
      customerName: "",
      tendered: 5000,
      paymentMethod: "cash",
    });

    // Shop B is exactly as it was.
    expect(await snapshotOf(shopB)).toBe(before);
  }, 60_000);

  it("a device of shop A pulls nothing of shop B, at any position", async () => {
    let cursor = 0;
    const all: unknown[] = [];
    for (let i = 0; i < 50; i++) {
      const page = await handlePull(mongo.db, shopA, cursor, 20);
      all.push(page.changes);
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    const text = JSON.stringify(all);
    // (Their ids, not their names: shop A's own sale of "an unknown product" may carry any name.)
    for (const mark of [
      b.product,
      b.sale,
      b.customer,
      b.supplier,
      b.purchase,
      b.expense,
    ])
      expect(text).not.toContain(mark);
  });
});
