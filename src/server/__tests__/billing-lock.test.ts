import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { endOfDhakaDay, marksFor } from "@/billing/state";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { assertBillingOpen } from "../billing-gate";
import { clearStoreCaches } from "../cache";
import { billingStamp } from "../shop-status";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
const end = endOfDhakaDay(2026, 9, 20);
const LOCKED_AT = new Date("2026-10-25T06:00:00Z");
const ACTIVE_AT = new Date("2026-10-05T06:00:00Z");

beforeAll(async () => {
  mongo = await startMongo();
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

async function shop(billing: Record<string, unknown> | null) {
  const id = await mongo.seedStore();
  if (billing)
    await mongo.db
      .collection<{ _id: string }>("stores")
      .updateOne({ _id: id }, { $set: { billing } });
  clearStoreCaches();
  return id;
}

const paid = {
  mode: "paid",
  planId: "m1",
  paidOnce: true,
  paidUntil: end,
  ...marksFor(end, 3, 7),
};

describe("the billing lock on the server", () => {
  it("lets a paid shop in until the grace days are over, then refuses with 402 and its billing", async () => {
    const id = await shop(paid);
    await expect(assertBillingOpen(mongo.db, id, ACTIVE_AT)).resolves.toBe(
      undefined,
    );
    const error = await assertBillingOpen(mongo.db, id, LOCKED_AT).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      status: 402,
      code: "BILLING_DUE",
      extra: {
        billing: expect.objectContaining({
          mode: "paid",
          plan: { name: "1 month", nameBn: "১ মাস" },
          lockAt: "2026-10-23T17:59:59.999Z",
        }),
      },
    });
  });

  it("never locks a shop without billing or a free shop", async () => {
    for (const billing of [null, { mode: "off" }, { mode: "free" }]) {
      const id = await shop(billing);
      await expect(
        assertBillingOpen(mongo.db, id, new Date("2040-01-01")),
      ).resolves.toBe(undefined);
    }
  });

  it("lets a locked shop in while its payment is being checked", async () => {
    const id = await shop({
      ...paid,
      provisionalUntil: new Date(LOCKED_AT.getTime() + 3_600_000),
    });
    await expect(assertBillingOpen(mongo.db, id, LOCKED_AT)).resolves.toBe(
      undefined,
    );
  });

  it("costs no database command once the shop has been looked up", async () => {
    const id = await shop(paid);
    await assertBillingOpen(mongo.db, id, ACTIVE_AT);
    await billingStamp(mongo.db, id, ACTIVE_AT);
    let commands = 0;
    const count = () => commands++;
    mongo.client.on("commandStarted", count);
    try {
      await assertBillingOpen(mongo.db, id, ACTIVE_AT);
      await billingStamp(mongo.db, id, ACTIVE_AT);
    } finally {
      mongo.client.off("commandStarted", count);
    }
    expect(commands).toBe(0);
  });
});
