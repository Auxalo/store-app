import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OP_SCHEMA_VERSION } from "@/commands/definitions";
import type { OpEnvelope, PushResult } from "@/schemas/sync";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { handlePush } from "../sync/push";

let mongo: TestMongo;
let storeId: string;
let owner: string;
let manager: string;
let cashier: string;
const device = randomUUID();

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  owner = await mongo.seedUser(storeId, "owner");
  manager = await mongo.seedUser(storeId, "manager");
  cashier = await mongo.seedUser(storeId, "cashier");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

let clock = Date.parse("2026-10-02T09:00:00.000Z");
const nextTime = () => {
  clock += 1000;
  return new Date(clock).toISOString();
};
const op = (
  type: string,
  payload: unknown,
  o: Partial<OpEnvelope> = {},
): OpEnvelope => ({
  operationId: randomUUID(),
  type,
  schemaVersion: OP_SCHEMA_VERSION,
  payload,
  actorUserId: owner,
  deviceId: device,
  createdAt: nextTime(),
  ...o,
});

async function push(...ops: OpEnvelope[]): Promise<PushResult[]> {
  return (
    await handlePush(
      mongo,
      { storeId, deviceId: device },
      { deviceId: device, appVersion: "1.0.0", ops },
    )
  ).results;
}

const col = (name: string) => mongo.db.collection(name);
async function addParty(kind: "customer" | "supplier") {
  const id = randomUUID();
  await push(op(`${kind}.create`, { id, name: "রহিম" }));
  return id;
}
const balanceOf = async (kind: "customers" | "suppliers", id: string) =>
  (await col(kind).findOne({ _id: id as never }))?.balance as number;
const ledgerSum = async (partyId: string) =>
  (await col("ledgerEntries").find({ partyId }).toArray()).reduce(
    (s, e) => s + e.amountDelta,
    0,
  );

describe("party.openingBalance", () => {
  it("adds a customer's previous due to their balance, with one ledger entry and no sale", async () => {
    const customer = await addParty("customer");
    const id = randomUUID();
    const [result] = await push(
      op("party.openingBalance", {
        id,
        partyType: "customer",
        partyId: customer,
        amount: 125_000,
        note: "খাতার বাকি",
      }),
    );
    expect(result.status).toBe("applied");
    expect(result.docs?.map((d) => d.collection).sort()).toEqual([
      "customers",
      "ledgerEntries",
    ]);
    expect(await balanceOf("customers", customer)).toBe(125_000);
    expect(await ledgerSum(customer)).toBe(125_000);
    expect(
      await col("ledgerEntries").findOne({ _id: `${id}:l` as never }),
    ).toMatchObject({
      refType: "opening",
      partyType: "customer",
      amountDelta: 125_000,
    });
    expect(await col("sales").countDocuments({ storeId })).toBe(0);
  });

  it("records what is owed to a supplier, and an advance as a negative amount", async () => {
    const supplier = await addParty("supplier");
    await push(
      op("party.openingBalance", {
        id: randomUUID(),
        partyType: "supplier",
        partyId: supplier,
        amount: 400_000,
      }),
    );
    expect(await balanceOf("suppliers", supplier)).toBe(400_000);

    const customer = await addParty("customer");
    await push(
      op("party.openingBalance", {
        id: randomUUID(),
        partyType: "customer",
        partyId: customer,
        amount: -30_000,
      }),
    );
    expect(await balanceOf("customers", customer)).toBe(-30_000);
    expect(await ledgerSum(customer)).toBe(-30_000);
  });

  it("applies once even if it is sent again under a different operation id", async () => {
    const customer = await addParty("customer");
    const payload = {
      id: randomUUID(),
      partyType: "customer",
      partyId: customer,
      amount: 50_000,
    };
    const [first] = await push(op("party.openingBalance", payload));
    const [again] = await push(op("party.openingBalance", payload));
    expect(first.status).toBe("applied");
    expect(again.status).toBe("applied");
    expect(await balanceOf("customers", customer)).toBe(50_000);
    expect(await ledgerSum(customer)).toBe(50_000);
  });

  it("only owners and managers may enter previous balances", async () => {
    const customer = await addParty("customer");
    const payload = (id: string) => ({
      id,
      partyType: "customer",
      partyId: customer,
      amount: 10_000,
    });
    const [denied] = await push(
      op("party.openingBalance", payload(randomUUID()), {
        actorUserId: cashier,
      }),
    );
    expect(denied).toMatchObject({ status: "rejected", error: "FORBIDDEN" });
    const [ok] = await push(
      op("party.openingBalance", payload(randomUUID()), {
        actorUserId: manager,
      }),
    );
    expect(ok.status).toBe("applied");
    expect(await balanceOf("customers", customer)).toBe(10_000);
  });

  it("rejects a balance for someone who does not exist, and a zero amount", async () => {
    const [missing] = await push(
      op("party.openingBalance", {
        id: randomUUID(),
        partyType: "customer",
        partyId: randomUUID(),
        amount: 1000,
      }),
    );
    expect(missing).toMatchObject({ status: "rejected", error: "NOT_FOUND" });

    const customer = await addParty("customer");
    const [zero] = await push(
      op("party.openingBalance", {
        id: randomUUID(),
        partyType: "customer",
        partyId: customer,
        amount: 0,
      }),
    );
    expect(zero.status).toBe("rejected");
    expect(await balanceOf("customers", customer)).toBe(0);
  });
});
