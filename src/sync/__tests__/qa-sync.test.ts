/**
 * QA audit: the device's sync queue (findings S1, S2, S4, S5).
 *
 * Each test states what SHOULD happen. `knownBug(...)` pins a confirmed bug: it passes while the
 * bug exists and starts failing when someone fixes it (then turn it into a normal `it`).
 * See docs/QA-REPORT.md.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import type { PushRequest } from "@/schemas/sync";
import { createDevice, type Device } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { knownBug } from "../../../tests/helpers/qa";
import { pushAll, resetBackoff } from "../engine";
import { type SyncTransport, TransportError } from "../transport";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
let storeId: string;
let ownerId: string;
let cashierId: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore("QA Sync Shop");
  ownerId = await mongo.seedUser(storeId, "owner");
  cashierId = await mongo.seedUser(storeId, "cashier");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const ownerDevice = () => createDevice(mongo, storeId, "owner", ownerId);
const cashierDevice = () => createDevice(mongo, storeId, "cashier", cashierId);

const col = (name: string) => mongo.db.collection(name);

const lineOf = (productId: string, over: Record<string, unknown> = {}) => ({
  productId,
  productName: "Milk",
  productNameBn: "",
  unit: "pcs" as const,
  qty: 1000,
  listPrice: 5000,
  unitPrice: 5000,
  unitCost: 4000,
  discount: 0,
  ...over,
});

async function addProduct(d: Device, stock = 100_000) {
  const id = newId();
  await runCommand(d.db, d.ctx, "product.create", {
    id,
    name: "Milk",
    sellingPrice: 5000,
    purchasePrice: 4000,
    openingStock: stock,
    openingMovementId: newId(),
  });
  return id;
}

async function addCustomer(d: Device, name = "Rahim") {
  const id = newId();
  await runCommand(d.db, d.ctx, "customer.create", { id, name });
  return id;
}

describe("QA S1: operations that depend on each other reach the server in order", () => {
  // A create that failed and is waiting out its backoff must not be overtaken by a later
  // operation that needs it.
  knownBug(
    "a credit sale to a customer whose creation is still waiting is not recorded without the due",
    async () => {
      const d = await ownerDevice();
      const milk = await addProduct(d);
      await d.sync(); // the product is on the server

      d.faults.offline = true;
      const rahim = await addCustomer(d);
      await expect(pushAll(d.db, d.transport, d.options)).rejects.toThrow(); // backs off ~5 s
      d.faults.offline = false;

      // The customer's creation is now waiting. The shop keeps selling to that customer.
      await runCommand(d.db, d.ctx, "sale.create", {
        id: newId(),
        customerId: rahim,
        customerName: "Rahim",
        lines: [lineOf(milk, { qty: 2000 })],
        tendered: 0,
      });
      await pushAll(d.db, d.transport, d.options); // no resetBackoff: the first op is still waiting
      await resetBackoff(d.db);
      await d.sync(); // everything is delivered by now

      // ৳100.00 was sold on credit to Rahim: the server must say he owes it.
      const customer = await col("customers").findOne({ _id: rahim as never });
      expect(customer?.balance).toBe(10_000);
    },
  );

  knownBug(
    "a sale of a product whose creation is still waiting still takes the goods out of stock",
    async () => {
      const d = await ownerDevice();
      d.faults.offline = true;
      const milk = await addProduct(d, 10_000);
      await expect(pushAll(d.db, d.transport, d.options)).rejects.toThrow();
      d.faults.offline = false;

      await runCommand(d.db, d.ctx, "sale.create", {
        id: newId(),
        lines: [lineOf(milk, { qty: 1000 })],
        tendered: 5000,
      });
      await pushAll(d.db, d.transport, d.options);
      await resetBackoff(d.db);
      await d.sync();

      // 10 in stock, 1 sold: 9 left.
      const product = await col("products").findOne({ _id: milk as never });
      expect(product?.stock).toBe(9_000);
    },
  );

  knownBug(
    "an operation is never sent ahead of an earlier one that is still waiting (what the queue should do)",
    async () => {
      const d = await ownerDevice();
      d.faults.offline = true;
      await addCustomer(d, "First");
      await expect(pushAll(d.db, d.transport, d.options)).rejects.toThrow();
      d.faults.offline = false;
      await addCustomer(d, "Second");

      const sent: string[] = [];
      const spy: SyncTransport = {
        ...d.transport,
        push: async (request: PushRequest) => {
          sent.push(...request.ops.map((o) => o.type));
          return d.transport.push(request);
        },
      };
      await pushAll(d.db, spy, d.options);
      // Either nothing is sent (the first one is waiting), or the first one goes before the second.
      // Sending only the second would be a change of order.
      expect(sent.length === 0 || sent.length === 2).toBe(true);
    },
  );
});

describe("QA S2: a refused operation leaves nothing behind on the device", () => {
  // A cashier's credit sale at a changed price is refused by the server (FORBIDDEN), but the
  // device took it: stock went down, the customer's balance went up, and the sale's lines and
  // movements were written. Only the sale record itself is taken back.
  async function refusedSale() {
    const o = await ownerDevice();
    const milk = await addProduct(o);
    const rahim = await addCustomer(o);
    await o.sync();

    const c = await cashierDevice();
    await c.sync();
    const saleId = newId();
    await runCommand(c.db, c.ctx, "sale.create", {
      id: saleId,
      customerId: rahim,
      customerName: "Rahim",
      lines: [lineOf(milk, { qty: 2000, unitPrice: 1000 })], // a cheaper price: needs the owner's permission
      tendered: 0,
    });
    await c.sync();
    return { c, milk, rahim, saleId };
  }

  it("the server refuses the sale and the device says so", async () => {
    const { c, saleId } = await refusedSale();
    expect(await col("sales").findOne({ _id: saleId as never })).toBeNull();
    const failed = await c.db.outbox.where("status").equals("failed").toArray();
    expect(failed.map((op) => op.lastError)).toContain("FORBIDDEN");
  });

  knownBug("the sale's lines are removed from the device", async () => {
    const { c, saleId } = await refusedSale();
    expect(await c.db.saleItems.where("saleId").equals(saleId).count()).toBe(0);
  });

  knownBug("the stock goes back to what it was", async () => {
    const { c, milk } = await refusedSale();
    expect((await c.db.products.get(milk))?.stock).toBe(100_000);
  });

  knownBug("the customer's balance goes back to what it was", async () => {
    const { c, rahim } = await refusedSale();
    expect((await c.db.customers.get(rahim))?.balance ?? 0).toBe(0);
  });

  knownBug("no ledger entry or stock movement of the sale stays", async () => {
    const { c, saleId } = await refusedSale();
    const ledger = await c.db.ledgerEntries.toArray();
    const movements = await c.db.stockMovements.toArray();
    expect(ledger.filter((l) => String(l.id).startsWith(saleId))).toEqual([]);
    expect(movements.filter((m) => String(m.id).startsWith(saleId))).toEqual(
      [],
    );
  });
});

describe("QA S4: a device whose shop is paused must not retry every second", () => {
  knownBug(
    "after a 'shop paused' answer the next attempts wait instead of going out again at once",
    async () => {
      const d = await ownerDevice();
      await runCommand(d.db, d.ctx, "category.create", {
        id: newId(),
        name: "Tea",
      });
      let calls = 0;
      const paused: SyncTransport = {
        push: async () => {
          calls++;
          throw new TransportError("suspended", "SHOP_SUSPENDED", 403);
        },
        pull: async () => {
          throw new TransportError("suspended", "SHOP_SUSPENDED", 403);
        },
      };
      for (let i = 0; i < 5; i++)
        await pushAll(d.db, paused, d.options).catch(() => undefined);
      // Five tries in the same instant: after the first, the operation should be backing off.
      expect(calls).toBe(1);
    },
  );

  knownBug("the waiting operation is not due again right away", async () => {
    const d = await ownerDevice();
    await runCommand(d.db, d.ctx, "category.create", {
      id: newId(),
      name: "Tea",
    });
    const paused: SyncTransport = {
      push: async () => {
        throw new TransportError("suspended", "SHOP_SUSPENDED", 403);
      },
      pull: async () => {
        throw new TransportError("suspended", "SHOP_SUSPENDED", 403);
      },
    };
    await pushAll(d.db, paused, d.options).catch(() => undefined);
    const [op] = await d.db.outbox.toArray();
    // The manager wakes at max(nextAttemptAt - now, 1 s): a due time in the past means every second.
    expect(op.nextAttemptAt).toBeGreaterThan(Date.now());
  });

  it("an ordinary network failure does back off (the behaviour a paused shop should share)", async () => {
    const d = await ownerDevice();
    await runCommand(d.db, d.ctx, "category.create", {
      id: newId(),
      name: "Tea",
    });
    d.faults.offline = true;
    await pushAll(d.db, d.transport, d.options).catch(() => undefined);
    const [op] = await d.db.outbox.toArray();
    expect(op.nextAttemptAt).toBeGreaterThan(Date.now());
  });
});

describe("QA S5: the size of a batch the device sends", () => {
  const MAX_BODY_BYTES = 1_000_000; // src/server/http.ts: anything larger is refused with 413

  knownBug(
    "a batch of big sales stays under the 1 MB the server accepts",
    async () => {
      const d = await ownerDevice();
      const milk = await addProduct(d, 1_000_000_000);
      await d.sync(); // the product is on the server; only the big sales are left to send
      // Ten sales of 200 lines each with long Bangla names (3 bytes a letter).
      for (let i = 0; i < 10; i++)
        await runCommand(d.db, d.ctx, "sale.create", {
          id: newId(),
          lines: Array.from({ length: 200 }, () =>
            lineOf(milk, {
              productName: "ম".repeat(110),
              productNameBn: "ম".repeat(110),
            }),
          ),
          tendered: 100_000_000,
        });

      const sizes: number[] = [];
      const capture: SyncTransport = {
        push: async (request) => {
          sizes.push(Buffer.byteLength(JSON.stringify(request)));
          throw new TransportError("network");
        },
        pull: async () => {
          throw new TransportError("network");
        },
      };
      await pushAll(d.db, capture, d.options).catch(() => undefined);
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes)
        expect(size).toBeLessThanOrEqual(MAX_BODY_BYTES);
    },
  );
});

describe("QA C1 and C2 on the device (offline mode, the default for new devices)", () => {
  const returnLine = (productId: string, qty: number, unitPrice: number) => ({
    itemIndex: 0,
    productId,
    productName: "Milk",
    productNameBn: "",
    unit: "pcs" as const,
    qty,
    unitPrice,
  });

  knownBug(
    "C1: voiding a sale after a return puts back only the goods not already returned",
    async () => {
      const d = await ownerDevice();
      const milk = await addProduct(d, 100_000);
      const rahim = await addCustomer(d);
      const saleId = newId();
      await runCommand(d.db, d.ctx, "sale.create", {
        id: saleId,
        customerId: rahim,
        customerName: "Rahim",
        lines: [lineOf(milk, { qty: 4000 })],
        tendered: 0,
      });
      await runCommand(d.db, d.ctx, "saleReturn.create", {
        id: newId(),
        saleId,
        lines: [returnLine(milk, 3000, 5000)],
        settlement: "credit",
        restock: true,
      });
      expect((await d.db.products.get(milk))?.stock).toBe(99_000);
      expect((await d.db.customers.get(rahim))?.balance).toBe(5_000);

      await runCommand(d.db, d.ctx, "sale.void", { saleId, reason: "x" });

      expect((await d.db.products.get(milk))?.stock).toBe(100_000);
      expect((await d.db.customers.get(rahim))?.balance).toBe(0);
    },
  );

  knownBug("C1: the same wrong result reaches the server", async () => {
    const d = await ownerDevice();
    const milk = await addProduct(d, 100_000);
    const rahim = await addCustomer(d);
    const saleId = newId();
    await runCommand(d.db, d.ctx, "sale.create", {
      id: saleId,
      customerId: rahim,
      customerName: "Rahim",
      lines: [lineOf(milk, { qty: 4000 })],
      tendered: 0,
    });
    await runCommand(d.db, d.ctx, "saleReturn.create", {
      id: newId(),
      saleId,
      lines: [returnLine(milk, 3000, 5000)],
      settlement: "credit",
      restock: true,
    });
    await runCommand(d.db, d.ctx, "sale.void", { saleId, reason: "x" });
    await d.sync();
    const product = await col("products").findOne({ _id: milk as never });
    expect(product?.stock).toBe(100_000);
  });

  knownBug(
    "C2: returning a sale that had a bill discount refunds what was paid",
    async () => {
      const d = await ownerDevice();
      const milk = await addProduct(d);
      const saleId = newId();
      await runCommand(d.db, d.ctx, "sale.create", {
        id: saleId,
        lines: [lineOf(milk, { qty: 1000 })],
        discount: 1000, // ৳10.00 off a ৳50.00 sale: paid ৳40.00
        tendered: 4000,
      });
      const returnId = newId();
      // The return screen refunds the line's unit price, as src/components/returns/return-dialog.tsx does.
      await runCommand(d.db, d.ctx, "saleReturn.create", {
        id: returnId,
        saleId,
        lines: [returnLine(milk, 1000, 5000)],
      });
      expect((await d.db.returns.get(returnId))?.total).toBe(4000);
    },
  );
});
