import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand } from "@/commands/local/run";
import { newId } from "@/lib/ids";
import { loadMoney } from "@/reports/cash-local";
import { dayKey } from "@/reports/compute";
import { serverMoney } from "@/server/cash";
import { createDevice } from "../../../tests/helpers/devices";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { pullAll } from "../engine";

/** A shop's own payment methods: saved, used in a sale, synced, and counted in the money figures. */

let mongo: TestMongo;
let storeId: string;
let ownerId: string;
const TZ = "Asia/Dhaka";

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  ownerId = await mongo.seedUser(storeId, "owner");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const newDevice = () => createDevice(mongo, storeId, "owner", ownerId);
const serverSetting = (key: string) =>
  mongo.db
    .collection("settings")
    .findOne({ _id: `${storeId}:${key}` as never });

describe("paymentMethod.save", () => {
  it("adds, renames and hides methods; they reach the server and a second device", async () => {
    const a = await newDevice();
    const code = `m_${newId().replace(/-/g, "")}`;
    await runCommand(a.db, a.ctx, "paymentMethod.save", {
      code,
      name: "Revolut",
      removed: false,
    });
    await runCommand(a.db, a.ctx, "paymentMethod.save", {
      code,
      name: "Revolut Pro",
      removed: false,
    });
    await runCommand(a.db, a.ctx, "paymentMethod.save", {
      code: "bkash",
      name: "",
      removed: true,
    });
    await a.sync();
    expect((await serverSetting(`payment.${code}`))?.value).toEqual({
      name: "Revolut Pro",
      removed: false,
    });
    expect((await serverSetting("payment.bkash"))?.value).toEqual({
      name: "",
      removed: true,
    });

    const b = await newDevice();
    await pullAll(b.db, b.transport);
    expect((await b.db.settings.get(`payment.${code}`))?.value).toMatchObject({
      name: "Revolut Pro",
    });
  });

  it("refuses to remove cash, bank or card, and a nameless own method", async () => {
    const d = await newDevice();
    await expect(
      runCommand(d.db, d.ctx, "paymentMethod.save", {
        code: "cash",
        name: "",
        removed: true,
      }),
    ).rejects.toThrow();
    await expect(
      runCommand(d.db, d.ctx, "paymentMethod.save", {
        code: "m_x",
        name: " ",
        removed: false,
      }),
    ).rejects.toThrow();
  });
});

describe("a sale paid with the shop's own method", () => {
  it("is accepted on the device and the server, and has its own line in the money figures", async () => {
    const d = await newDevice();
    const code = `m_${newId().replace(/-/g, "")}`;
    await runCommand(d.db, d.ctx, "paymentMethod.save", {
      code,
      name: "Revolut",
      removed: false,
    });
    const milk = newId();
    await runCommand(d.db, d.ctx, "product.create", {
      id: milk,
      name: "দুধ",
      nameBn: "",
      sellingPrice: 150_000,
      purchasePrice: 131_300,
      openingStock: 10_000,
      openingMovementId: newId(),
    });
    await runCommand(d.db, d.ctx, "sale.create", {
      id: newId(),
      customerId: null,
      customerName: "",
      lines: [
        {
          productId: milk,
          productName: "দুধ",
          productNameBn: "",
          unit: "pcs",
          qty: 2_000,
          listPrice: 150_000,
          unitPrice: 150_000,
          unitCost: 131_300,
          discount: 0,
        },
      ],
      tendered: 300_000,
      paymentMethod: code,
    });
    const result = await d.sync();
    expect(result).toBeDefined();

    const today = dayKey(Date.now(), TZ);
    const range = { from: today, to: today };
    const device = await loadMoney(d.db, range, TZ);
    expect(device.methods[code].totalIn).toBe(300_000);
    expect(device.methods.cash.totalIn).toBe(0);
    // Built-in methods always have a line, even with nothing in them.
    expect(device.methods.rocket).toBeDefined();

    const server = await serverMoney(mongo.db, storeId, range, TZ);
    expect(server).toEqual(device);
    const sale = await mongo.db
      .collection("sales")
      .findOne({ storeId, paymentMethod: code });
    expect(sale).not.toBeNull();
  });
});
