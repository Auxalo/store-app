import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { runOnlineCommand } from "../online-commands";
import {
  exportShop,
  RestoreError,
  restoreShop,
  SHOP_COLLECTIONS,
  verifyExport,
  wipeShop,
} from "../shop-export";

let mongo: TestMongo;
let shopA: string;
let shopB: string;
let ownerA: string;
let ownerB: string;

beforeAll(async () => {
  mongo = await startMongo();
  shopA = await mongo.seedStore("Shop A");
  shopB = await mongo.seedStore("Shop B");
  ownerA = await mongo.seedUser(shopA, "owner", { username: "owner-a" });
  ownerB = await mongo.seedUser(shopB, "owner", { username: "owner-b" });
  for (const id of [ownerA, ownerB]) {
    await mongo.db.collection("account").insertOne({
      userId: new ObjectId(id),
      providerId: "credential",
      password: `hash-${id}`,
    } as never);
    await mongo.db.collection("session").insertOne({
      userId: new ObjectId(id),
      token: `t-${id}`,
      expiresAt: new Date(Date.now() + 1e9),
    } as never);
  }
  await fill(shopA, ownerA, "AAA");
  await fill(shopB, ownerB, "BBB");
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const run = (shop: string, owner: string, type: string, input: unknown) =>
  runOnlineCommand(
    mongo,
    { id: owner, role: "owner", storeId: shop, deviceId: "d" },
    { operationId: randomUUID(), type, input },
  );

async function fill(shop: string, owner: string, tag: string) {
  const product = randomUUID();
  const customer = randomUUID();
  const ok = (r: { ok: boolean }) => expect(r.ok).toBe(true);
  ok(
    await run(shop, owner, "product.create", {
      id: product,
      name: `${tag} Milk ডিম`,
      purchasePrice: 4000,
      sellingPrice: 5000,
      openingStock: 100_000,
      openingMovementId: randomUUID(),
      sku: `${tag}-1`,
    }),
  );
  ok(
    await run(shop, owner, "customer.create", {
      id: customer,
      name: `${tag} রহিম`,
      phone: "01711000000",
    }),
  );
  ok(
    await run(shop, owner, "sale.create", {
      id: randomUUID(),
      lines: [
        {
          productId: product,
          productName: "Milk",
          productNameBn: "",
          unit: "pcs",
          qty: 2000,
          listPrice: 5000,
          unitPrice: 5000,
          unitCost: 0,
          discount: 0,
        },
      ],
      customerId: customer,
      customerName: "",
      tendered: 4000,
      paymentMethod: "cash",
    }),
  );
  ok(
    await run(shop, owner, "expense.create", {
      id: randomUUID(),
      category: "rent",
      amount: 1000,
      date: "2026-10-02",
      description: `${tag} rent`,
    }),
  );
  ok(
    await run(shop, owner, "setting.set", {
      key: "receipt.footer",
      value: `${tag} thanks`,
    }),
  );
}

/** Everything a shop holds, as text, to compare before and after. */
async function snapshot(shop: string): Promise<string> {
  const out: Record<string, unknown[]> = {};
  const users = await mongo.db
    .collection("user")
    .find({ storeId: shop } as never)
    .toArray();
  const userIds = users.map((u) => u._id);
  out.user = users;
  out.account = await mongo.db
    .collection("account")
    .find({ userId: { $in: userIds } } as never)
    .sort({ _id: 1 })
    .toArray();
  out.counters = await mongo.db
    .collection("counters")
    .find({ _id: { $regex: `^${shop}:` } } as never)
    .sort({ _id: 1 })
    .toArray();
  for (const name of SHOP_COLLECTIONS)
    out[name] = await mongo.db
      .collection(name)
      .find({ storeId: shop } as never)
      .sort({ _id: 1 })
      .toArray();
  out.stores = await mongo.db
    .collection("stores")
    .find({ _id: shop as never })
    .toArray();
  return JSON.stringify(out);
}

async function exportLines(shop: string): Promise<string[]> {
  const lines: string[] = [];
  await exportShop(mongo.db, shop, (line) => {
    lines.push(line);
  });
  return lines;
}

async function* iter(lines: string[]) {
  for (const line of lines) yield line;
}

describe("backing up and restoring one shop", () => {
  it("brings back exactly what the shop had, and never touches another shop", async () => {
    const lines = await exportLines(shopA);
    const before = await snapshot(shopA);
    const otherBefore = await snapshot(shopB);
    expect(before.length).toBeGreaterThan(500); // a real shop, not an empty one
    // The shop's records and its people; not other shops' and not sign-in sessions.
    expect(lines.join("\n")).not.toContain("BBB");
    expect(lines.join("\n")).not.toContain("t-");

    await wipeShop(mongo.db, shopA);
    expect(
      await mongo.db.collection("products").countDocuments({ storeId: shopA }),
    ).toBe(0);
    expect(
      await mongo.db
        .collection("stores")
        .countDocuments({ _id: shopA as never }),
    ).toBe(0);
    expect(await snapshot(shopB)).toBe(otherBefore); // the wipe stayed inside shop A

    const result = await restoreShop(mongo.db, () => iter(lines));
    expect(result.header.storeId).toBe(shopA);
    expect(await snapshot(shopA)).toBe(before);
    expect(await snapshot(shopB)).toBe(otherBefore);
  }, 60_000);

  it("refuses to restore over an existing shop unless told to replace it, and replaces only that shop", async () => {
    const lines = await exportLines(shopA);
    const otherBefore = await snapshot(shopB);
    await expect(
      restoreShop(mongo.db, () => iter(lines)),
    ).rejects.toMatchObject({ code: "SHOP_EXISTS" });

    // A change made after the backup is undone by a replace.
    await mongo.db
      .collection("customers")
      .updateMany({ storeId: shopA } as never, {
        $set: { name: "changed later" },
      });
    const before = await snapshot(shopA);
    expect(before).toContain("changed later");
    // What the operator decided since the backup (billing, a pause) is kept by the restore.
    const billing = { mode: "paid", paidOnce: true, planId: "m12" };
    await mongo.db
      .collection<{ _id: string }>("stores")
      .updateOne({ _id: shopA }, { $set: { billing, status: "suspended" } });
    await restoreShop(mongo.db, () => iter(lines), { replace: true });
    expect(await snapshot(shopA)).not.toContain("changed later");
    expect(await snapshot(shopB)).toBe(otherBefore);
    const store = await mongo.db
      .collection<{ _id: string }>("stores")
      .findOne({ _id: shopA });
    expect(store).toMatchObject({ billing, status: "suspended" });
    await mongo.db
      .collection<{ _id: string }>("stores")
      .updateOne({ _id: shopA }, { $unset: { status: "" } });
  }, 60_000);

  it("a dry run checks the file and writes nothing", async () => {
    const lines = await exportLines(shopA);
    await wipeShop(mongo.db, shopA);
    const result = await restoreShop(mongo.db, () => iter(lines), {
      dryRun: true,
    });
    expect(result.counts.products).toBe(1);
    expect(
      await mongo.db
        .collection("stores")
        .countDocuments({ _id: shopA as never }),
    ).toBe(0);
    await restoreShop(mongo.db, () => iter(lines)); // and put it back for the next tests
  }, 60_000);

  it("refuses a file that holds a record of another shop, before writing anything", async () => {
    const lines = await exportLines(shopA);
    const otherBefore = await snapshot(shopB);
    const tampered = lines.map((line) => {
      if (!line.includes('"c":"products"')) return line;
      const entry = JSON.parse(line);
      entry.d.storeId = shopB; // pretend a product belongs to shop B
      return JSON.stringify(entry);
    });
    await expect(
      restoreShop(mongo.db, () => iter(tampered), { replace: true }),
    ).rejects.toMatchObject({ code: "FOREIGN_RECORD" });
    expect(await snapshot(shopB)).toBe(otherBefore);
    expect(
      await mongo.db
        .collection("stores")
        .countDocuments({ _id: shopA as never }),
    ).toBe(1); // shop A untouched too
  });

  it("refuses a changed, cut-off or foreign-looking file", async () => {
    const lines = await exportLines(shopA);

    const edited = lines.map((l) => l.replace("AAA Milk", "AAA Milk!"));
    await expect(verifyExport(iter(edited))).rejects.toMatchObject({
      code: "BAD_CHECKSUM",
    });

    await expect(verifyExport(iter(lines.slice(0, -1)))).rejects.toMatchObject({
      code: "BAD_FILE",
    });
    await expect(verifyExport(iter(["not json"]))).rejects.toBeInstanceOf(
      RestoreError,
    );
    await expect(
      verifyExport(iter(lines.filter((l) => !l.includes('"c":"sales"')))),
    ).rejects.toBeTruthy();
  });

  it("refuses to restore a person whose username now belongs to someone else", async () => {
    const lines = await exportLines(shopA);
    await wipeShop(mongo.db, shopA);
    await mongo.seedUser(shopB, "cashier", { username: "owner-a" });
    await expect(
      restoreShop(mongo.db, () => iter(lines)),
    ).rejects.toMatchObject({ code: "USERNAME_TAKEN" });
    expect(
      await mongo.db
        .collection("stores")
        .countDocuments({ _id: shopA as never }),
    ).toBe(0);
  });
});
