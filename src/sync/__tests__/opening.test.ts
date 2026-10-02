import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { dayKey } from "@/reports/compute";
import { loadDues, loadSummary } from "@/reports/local";
import { createDevice, type Device } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { pullAll } from "../engine";

let mongo: TestMongo;
let storeId: string;
let ownerId: string;
let cashierId: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  ownerId = await mongo.seedUser(storeId, "owner");
  cashierId = await mongo.seedUser(storeId, "cashier");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const owner = () => createDevice(mongo, storeId, "owner", ownerId);

async function party(d: Device, kind: "customer" | "supplier") {
  const id = newId();
  await runCommand(d.db, d.ctx, `${kind}.create`, { id, name: "রহিম" });
  return id;
}

describe("opening balances on devices", () => {
  it("show at once, survive a pull before they are sent, and reach every device once", async () => {
    const a = await owner();
    const b = await owner();
    const customer = await party(a, "customer");
    await a.sync();
    await b.sync();

    await runCommand(a.db, a.ctx, "party.openingBalance", {
      id: newId(),
      partyType: "customer",
      partyId: customer,
      amount: 250_000,
      note: "আগের বাকি",
    });
    expect((await a.db.customers.get(customer))?.balance).toBe(250_000);
    const [entry] = await a.db.ledgerEntries.toArray();
    expect(entry).toMatchObject({ refType: "opening", amountDelta: 250_000 });

    // The server does not have it yet; a pull must not make it disappear from the screen.
    await pullAll(a.db, a.transport);
    expect((await a.db.customers.get(customer))?.balance).toBe(250_000);

    await a.sync();
    await b.sync();
    for (const d of [a, b]) {
      expect((await d.db.customers.get(customer))?.balance).toBe(250_000);
      expect(await d.db.ledgerEntries.count()).toBe(1);
    }
    expect(
      (
        await mongo.db
          .collection("customers")
          .findOne({ _id: customer as never })
      )?.balance,
    ).toBe(250_000);
  });

  it("add to dues but never to sales, profit or purchases", async () => {
    // Its own store, so dues from the other tests do not count here.
    const ownStore = await mongo.seedStore("Own Store");
    const a = await createDevice(
      mongo,
      ownStore,
      "owner",
      await mongo.seedUser(ownStore, "owner"),
    );
    const customer = await party(a, "customer");
    const supplier = await party(a, "supplier");
    await runCommand(a.db, a.ctx, "party.openingBalance", {
      id: newId(),
      partyType: "customer",
      partyId: customer,
      amount: 120_000,
    });
    await runCommand(a.db, a.ctx, "party.openingBalance", {
      id: newId(),
      partyType: "supplier",
      partyId: supplier,
      amount: 900_000,
    });
    await a.sync();

    const dues = await loadDues(a.db);
    expect(dues.customerTotal).toBe(120_000);
    expect(dues.supplierTotal).toBe(900_000);

    const today = dayKey(Date.now());
    const range = { from: today, to: today };
    expect(await loadSummary(a.db, range)).toMatchObject({
      salesCount: 0,
      total: 0,
      profit: 0,
      expenses: 0,
      purchasesCount: 0,
      purchasesTotal: 0,
      purchasesDue: 0,
    });
  });

  it("a payment against an opening balance brings it down correctly", async () => {
    const a = await owner();
    const customer = await party(a, "customer");
    await runCommand(a.db, a.ctx, "party.openingBalance", {
      id: newId(),
      partyType: "customer",
      partyId: customer,
      amount: 100_000,
    });
    await runCommand(a.db, a.ctx, "payment.collect", {
      id: newId(),
      partyId: customer,
      amount: 40_000,
    });
    await a.sync();
    expect((await a.db.customers.get(customer))?.balance).toBe(60_000);
    const ledger = await a.db.ledgerEntries
      .where("partyId")
      .equals(customer)
      .toArray();
    expect(ledger.reduce((s, e) => s + e.amountDelta, 0)).toBe(60_000);
  });

  it("a cashier cannot enter one, and nothing is queued", async () => {
    const a = await owner();
    const customer = await party(a, "customer");
    const cashier = await createDevice(mongo, storeId, "cashier", cashierId);
    await expect(
      runCommand(cashier.db, cashier.ctx, "party.openingBalance", {
        id: newId(),
        partyType: "customer",
        partyId: customer,
        amount: 1000,
      }),
    ).rejects.toThrow();
    expect(await cashier.db.outbox.count()).toBe(0);
  });

  it("an opening balance for someone missing is refused on this device and queues nothing", async () => {
    const a = await owner();
    await expect(
      runCommand(a.db, a.ctx, "party.openingBalance", {
        id: newId(),
        partyType: "customer",
        partyId: newId(),
        amount: 1000,
      }),
    ).rejects.toThrow();
    expect(await a.db.outbox.count()).toBe(0);
  });
});
