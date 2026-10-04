/**
 * H2, from the device's side: the actions a person queues are signed with the key their PIN makes,
 * and the server accepts an owner's or manager's action only with that signature. These tests run
 * the real device queue against the real server logic.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashPin } from "@/auth/pin";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { createDevice } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";

vi.mock("server-only", () => ({}));

let mongo: TestMongo;
let storeId: string;
let ownerId: string;
let cashierId: string;
let ownerKey: string;

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore("Proof Shop");
  const ownerPin = await hashPin("482913");
  const cashierPin = await hashPin("1234");
  ownerKey = ownerPin.proof as string;
  ownerId = await mongo.seedUser(storeId, "owner", {
    pinSalt: ownerPin.salt,
    pinHash: ownerPin.hash,
    pinProofKey: ownerPin.proof,
  });
  cashierId = await mongo.seedUser(storeId, "cashier", {
    pinSalt: cashierPin.salt,
    pinHash: cashierPin.hash,
    pinProofKey: cashierPin.proof,
  });
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const col = (name: string) => mongo.db.collection(name);

describe("signed offline work", () => {
  it("the owner's action, signed with their PIN key, is accepted from a device a cashier set up", async () => {
    const device = await createDevice(mongo, storeId, "owner", ownerId, {
      proofKey: ownerKey,
      registeredBy: cashierId,
    });
    const id = newId();
    await runCommand(device.db, device.ctx, "category.create", {
      id,
      name: "Signed",
    });
    const [queued] = await device.db.outbox.toArray();
    expect(queued.proof).toBeTruthy();
    await device.sync();
    expect(await col("categories").countDocuments({ _id: id as never })).toBe(
      1,
    );
    expect((await device.db.outbox.toArray())[0].status).toBe("synced");
  });

  it("the same action without the signature is refused, and the device takes it back", async () => {
    const device = await createDevice(mongo, storeId, "owner", ownerId, {
      registeredBy: cashierId, // a cashier's phone, naming the owner
    });
    const id = newId();
    await runCommand(device.db, device.ctx, "category.create", {
      id,
      name: "Forged",
    });
    await device.sync();
    expect(await col("categories").countDocuments({ _id: id as never })).toBe(
      0,
    );
    const [op] = await device.db.outbox.toArray();
    expect(op).toMatchObject({ status: "failed", lastError: "PROOF_REQUIRED" });
    expect(await device.db.categories.get(id)).toBeUndefined();
  });

  it("an action signed with someone else's key is refused", async () => {
    const stolen = (await hashPin("1234")).proof as string; // the cashier's
    const device = await createDevice(mongo, storeId, "owner", ownerId, {
      proofKey: stolen,
      registeredBy: cashierId,
    });
    const id = newId();
    await runCommand(device.db, device.ctx, "category.create", {
      id,
      name: "Borrowed",
    });
    await device.sync();
    expect(await col("categories").countDocuments({ _id: id as never })).toBe(
      0,
    );
  });

  it("a cashier still sells with no extra step", async () => {
    const owner = await createDevice(mongo, storeId, "owner", ownerId, {
      proofKey: ownerKey,
      registeredBy: ownerId,
    });
    const productId = newId();
    await runCommand(owner.db, owner.ctx, "product.create", {
      id: productId,
      name: "Milk",
      sellingPrice: 5000,
      purchasePrice: 4000,
      openingStock: 10_000,
      openingMovementId: newId(),
    });
    await owner.sync();

    const cashier = await createDevice(mongo, storeId, "cashier", cashierId);
    await cashier.sync();
    const saleId = newId();
    await runCommand(cashier.db, cashier.ctx, "sale.create", {
      id: saleId,
      lines: [
        {
          productId,
          productName: "Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 1000,
          listPrice: 5000,
          unitPrice: 5000,
          unitCost: 0,
          discount: 0,
        },
      ],
      tendered: 5000,
    });
    await cashier.sync();
    expect(await col("sales").countDocuments({ _id: saleId as never })).toBe(1);
  });

  it("an owner's edit that went through a conflict ('keep mine') is still accepted", async () => {
    const device = await createDevice(mongo, storeId, "owner", ownerId, {
      proofKey: ownerKey,
      registeredBy: cashierId,
    });
    const id = newId();
    await runCommand(device.db, device.ctx, "category.create", {
      id,
      name: "Before",
    });
    await device.sync();
    await runCommand(device.db, device.ctx, "category.update", {
      id,
      changes: { name: "After" },
    });
    // What "keep mine" does to a queued edit: it is re-based on the server's version.
    const [, edit] = await device.db.outbox.toArray();
    await device.db.outbox.update(edit.seq as number, {
      payload: {
        ...(edit.payload as Record<string, unknown>),
        baseVersion: 1,
      },
    });
    await device.sync();
    expect((await col("categories").findOne({ _id: id as never }))?.name).toBe(
      "After",
    );
  });
});
