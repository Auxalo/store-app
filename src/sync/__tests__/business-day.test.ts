import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import type { StoreDB } from "@/db/local/db";
import { newId } from "@/lib/ids";
import { createDevice, type Device } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { syncOnce } from "../engine";

/**
 * A whole shop day, simulated: three devices, 200 random actions (sales, credit sales, cancellations,
 * returns, stock adjustments, expenses, customer payments), phones dropping off and the network
 * flapping all day. At the end everyone reconnects and the books must agree everywhere:
 * no duplicates, stock equals the sum of its movements, every balance equals the sum of its ledger.
 *
 * The random generator is seeded, so a failure can be replayed exactly (set SEED to rerun it).
 */
const SEED = Number(process.env.SEED ?? 20261002);
const ACTIONS = 200;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

const col = (name: string) => mongo.db.collection(name);

describe("a simulated business day", () => {
  it("3 devices, 200 actions, a flapping network: zero duplicates and books that balance", async () => {
    const rand = rng(SEED);
    const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
    let clock = Date.now();
    const devices: Device[] = [];
    for (let i = 0; i < 3; i++)
      devices.push(await createDevice(mongo, storeId, "owner", ownerId));
    const sync = (d: Device) =>
      syncOnce(d.db, d.transport, { ...d.options, now: () => clock }).catch(
        () => undefined,
      );

    // Morning: one device sets up the shop and everyone downloads it.
    const [a] = devices;
    const products: Array<{
      id: string;
      name: string;
      price: number;
      cost: number;
    }> = [];
    for (const [name, price, cost] of [
      ["Milk", 5000, 4000],
      ["Rice", 12_000, 9000],
      ["Oil", 18_000, 15_000],
      ["Sugar", 9000, 7000],
      ["Tea", 6000, 4500],
    ] as const) {
      const id = newId();
      products.push({ id, name, price, cost });
      await runCommand(a.db, a.ctx, "product.create", {
        id,
        name,
        nameBn: "",
        sellingPrice: price,
        purchasePrice: cost,
        openingStock: 1_000_000,
        openingMovementId: newId(),
      });
    }
    const customers: string[] = [];
    for (const name of ["রহিম", "করিম", "সালমা"]) {
      const id = newId();
      customers.push(id);
      await runCommand(a.db, a.ctx, "customer.create", { id, name, phone: "" });
    }
    for (let i = 0; i < 3; i++) for (const d of devices) await sync(d);

    // The sales each device knows about, so it can cancel or take returns on them.
    const known = new Map<
      Device,
      Array<{ id: string; productId: string; name: string; price: number }>
    >(devices.map((d) => [d, []]));
    let attempted = 0;

    for (let n = 0; n < ACTIONS; n++) {
      // Phones come and go; the network flaps.
      for (const d of devices) {
        d.faults.offline = rand() < 0.3;
        d.faults.flaky = rand() < 0.5 ? 0.4 : 0;
        d.faults.dropNextResponses = rand() < 0.1 ? 1 : 0;
      }
      const d = pick(devices);
      const roll = rand();
      try {
        if (roll < 0.62) {
          const lineProducts = [
            pick(products),
            ...(rand() < 0.3 ? [pick(products)] : []),
          ];
          const lines = lineProducts.map((p) => ({
            productId: p.id,
            productName: p.name,
            productNameBn: "",
            unit: "pcs" as const,
            qty: (1 + Math.floor(rand() * 3)) * 1000,
            listPrice: p.price,
            unitPrice: p.price,
            unitCost: p.cost,
            discount: 0,
          }));
          const onCredit = rand() < 0.25;
          const id = newId();
          await runCommand(d.db, d.ctx, "sale.create", {
            id,
            lines,
            discount: rand() < 0.15 ? 500 : 0,
            tendered: onCredit ? 0 : 10_000_000,
            ...(onCredit
              ? { customerId: pick(customers), customerName: "x" }
              : {}),
            paymentMethod: pick(["cash", "bkash", "nagad"] as const),
          });
          attempted++;
          known.get(d)?.push({
            id,
            productId: lines[0].productId,
            name: lines[0].productName,
            price: lines[0].unitPrice,
          });
        } else if (roll < 0.68) {
          const sale = pick(known.get(d) ?? []);
          if (sale)
            await runCommand(d.db, d.ctx, "sale.void", {
              saleId: sale.id,
              reason: "sim",
            });
        } else if (roll < 0.74) {
          const sale = pick(known.get(d) ?? []);
          if (sale)
            await runCommand(d.db, d.ctx, "saleReturn.create", {
              id: newId(),
              saleId: sale.id,
              lines: [
                {
                  itemIndex: 0,
                  productId: sale.productId,
                  productName: sale.name,
                  productNameBn: "",
                  unit: "pcs",
                  qty: 1000,
                  unitPrice: sale.price,
                },
              ],
              settlement: "cash",
            });
        } else if (roll < 0.8) {
          await runCommand(d.db, d.ctx, "stock.adjust", {
            productId: pick(products).id,
            movementId: newId(),
            type: pick(["adjustment", "damage", "correction"] as const),
            qtyDelta: rand() < 0.5 ? -2000 : 3000,
            note: "sim",
          });
        } else if (roll < 0.87) {
          await runCommand(d.db, d.ctx, "expense.create", {
            id: newId(),
            category: pick(["rent", "transport", "food"] as const),
            amount: 1000 + Math.floor(rand() * 9000),
            date: new Date(clock).toISOString().slice(0, 10),
            description: "",
          });
        } else {
          await runCommand(d.db, d.ctx, "payment.collect", {
            id: newId(),
            partyId: pick(customers),
            amount: 1000 + Math.floor(rand() * 5000),
          });
        }
      } catch {
        // The device itself refused (for example returning more than was sold): nothing was queued.
      }
      if (rand() < 0.35) await sync(pick(devices));
      clock += 60_000;
    }

    // Evening: everyone reconnects and syncs until nothing is left to send.
    for (const d of devices) {
      d.faults.offline = false;
      d.faults.flaky = 0;
      d.faults.dropNextResponses = 0;
    }
    const pending = (db: StoreDB) =>
      db.outbox.where("status").anyOf("pending", "syncing").count();
    for (let round = 0; round < 12; round++) {
      clock += 30 * 60_000; // let any back-off expire
      for (const d of devices) await sync(d);
      const left = await Promise.all(devices.map((d) => pending(d.db)));
      if (left.every((n) => n === 0) && round >= 2) break;
    }
    for (const d of devices) expect(await pending(d.db)).toBe(0);

    // --- the books ---
    const serverSales = await col("sales").find({ storeId }).toArray();
    const ids = serverSales.map((s) => String(s._id));
    expect(new Set(ids).size).toBe(ids.length); // no duplicate sales
    const invoices = serverSales.map((s) => s.invoiceNo as string);
    expect(new Set(invoices).size).toBe(invoices.length); // no duplicate invoice numbers
    expect(serverSales.length).toBe(attempted); // every sale made reached the server, once

    const serverIds = new Set(ids);
    for (const d of devices) {
      const local = await d.db.sales.toArray();
      expect(new Set(local.map((s) => s.id))).toEqual(serverIds); // every device has every sale
      expect(await d.db.sales.where("status").equals("voided").count()).toBe(
        serverSales.filter((s) => s.status === "voided").length,
      );
    }

    // Stock is exactly the sum of its movements, on the server and on every device.
    for (const p of products) {
      const movements = await col("stockMovements")
        .find({ storeId, productId: p.id })
        .toArray();
      const sum = movements.reduce((s, m) => s + (m.qtyDelta as number), 0);
      const doc = await col("products").findOne({ _id: p.id as never });
      expect(doc?.stock, `server stock of ${p.name}`).toBe(sum);
      expect(new Set(movements.map((m) => String(m._id))).size).toBe(
        movements.length,
      );
      for (const d of devices)
        expect(
          (await d.db.products.get(p.id))?.stock,
          `device stock of ${p.name}`,
        ).toBe(sum);
    }

    // Every customer's balance is exactly the sum of their ledger.
    for (const id of customers) {
      const ledger = await col("ledgerEntries")
        .find({ storeId, partyId: id })
        .toArray();
      const sum = ledger.reduce((s, e) => s + (e.amountDelta as number), 0);
      expect(
        (await col("customers").findOne({ _id: id as never }))?.balance,
        "server balance",
      ).toBe(sum);
      for (const d of devices)
        expect((await d.db.customers.get(id))?.balance, "device balance").toBe(
          sum,
        );
    }

    // Expenses and payments: no duplicates either.
    for (const name of ["expenses", "payments", "returns"]) {
      const docs = await col(name).find({ storeId }).toArray();
      expect(new Set(docs.map((x) => String(x._id))).size).toBe(docs.length);
      for (const d of devices)
        expect(await d.db.table(name).count(), `${name} on a device`).toBe(
          docs.length,
        );
    }
  }, 300_000);
});
