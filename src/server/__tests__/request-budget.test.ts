import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseListParams } from "@/data/spec";
import { startMongo, type TestMongo } from "../../../tests/helpers/mongo";
import { clearStoreCaches } from "../cache";
import {
  getRecord,
  listResource,
  lookupProduct,
  totalsOf,
  type Viewer,
} from "../data/service";
import {
  checkDevice,
  DEVICE_COOKIE,
  deviceCookieValue,
  registerDevice,
} from "../devices";
import { runOnlineCommand } from "../online-commands";

/**
 * How many database commands one online request may cost, on a server that has already warmed up.
 * Every command is a round trip to the database (about 200 ms when the server is far from it), so
 * this is a speed guard: a change that adds a read to every request, or puts index creation back
 * on the request path, fails here before it reaches a customer.
 */

let mongo: TestMongo;
let storeId: string;
let owner: string;
let viewer: Viewer;

const names: string[] = [];
const IGNORED = new Set([
  "hello",
  "isMaster",
  "ismaster",
  "saslStart",
  "saslContinue",
  "endSessions",
  "ping",
]);

async function commandsOf(work: () => Promise<unknown>): Promise<string[]> {
  names.length = 0;
  await work();
  return names.filter((n) => !IGNORED.has(n));
}

beforeAll(async () => {
  mongo = await startMongo();
  mongo.client.on("commandStarted", (event) => names.push(event.commandName));
  storeId = await mongo.seedStore();
  owner = await mongo.seedUser(storeId, "owner");
  viewer = { storeId, canSeeCost: true };
}, 120_000);

afterAll(async () => {
  await mongo?.stop();
});

const actor = () => ({
  id: owner,
  role: "owner" as const,
  storeId,
  deviceId: "budget-device",
});

const create = (over: Record<string, unknown> = {}) => {
  const id = randomUUID();
  return {
    id,
    result: runOnlineCommand(mongo, actor(), {
      operationId: randomUUID(),
      type: "product.create",
      input: {
        id,
        name: "Milk",
        purchasePrice: 4000,
        sellingPrice: 5000,
        openingStock: 100_000,
        openingMovementId: randomUUID(),
        sku: `SKU-${id.slice(0, 6)}`,
        ...over,
      },
    }),
  };
};

const lineFor = (productId: string) => ({
  productId,
  productName: "Milk",
  productNameBn: "",
  unit: "pcs",
  qty: 1000,
  listPrice: 5000,
  unitPrice: 5000,
  unitCost: 0,
  discount: 0,
});

describe("database commands per online request (warm server)", () => {
  it("none of them creates an index", async () => {
    const seen = await commandsOf(async () => {
      await listResource(
        mongo.db,
        "products",
        parseListParams("products", {}),
        viewer,
      );
    });
    expect(seen).not.toContain("createIndexes");
  });

  it("a product list is one query", async () => {
    await listResource(
      mongo.db,
      "products",
      parseListParams("products", {}),
      viewer,
    );
    const seen = await commandsOf(() =>
      listResource(
        mongo.db,
        "products",
        parseListParams("products", {}),
        viewer,
      ),
    );
    expect(seen.length).toBeLessThanOrEqual(1);
  });

  it("a search by code is two queries at once, not one after the other", async () => {
    await listResource(
      mongo.db,
      "products",
      parseListParams("products", { q: "x" }),
      viewer,
    );
    const seen = await commandsOf(() =>
      listResource(
        mongo.db,
        "products",
        parseListParams("products", { q: "x1234" }),
        viewer,
      ),
    );
    expect(seen.length).toBeLessThanOrEqual(2);
  });

  it("totals are one aggregate", async () => {
    await totalsOf(
      mongo.db,
      "products",
      parseListParams("products", {}),
      viewer,
    );
    const seen = await commandsOf(() =>
      totalsOf(mongo.db, "products", parseListParams("products", {}), viewer),
    );
    expect(seen.length).toBeLessThanOrEqual(1);
  });

  it("one record with its related rows is two queries at once", async () => {
    const { id, result } = create();
    await result;
    const seen = await commandsOf(() =>
      getRecord(mongo.db, "products", id, viewer),
    );
    expect(seen.length).toBeLessThanOrEqual(2);
  });

  it("a code lookup is one query", async () => {
    const seen = await commandsOf(() =>
      lookupProduct(mongo.db, "nothing", viewer),
    );
    expect(seen.length).toBe(1);
  });

  it("a device that was just seen costs no database read to check again", async () => {
    clearStoreCaches();
    const deviceId = randomUUID();
    const registration = await registerDevice(mongo.db, {
      storeId,
      userId: owner,
      deviceId,
      name: "Test",
      existing: { ok: false, reason: "missing" },
    });
    const cookie = `${DEVICE_COOKIE}=${deviceCookieValue(deviceId, registration.token as string)}`;
    expect((await checkDevice(mongo.db, cookie)).ok).toBe(true);
    const seen = await commandsOf(() => checkDevice(mongo.db, cookie));
    expect(seen).toEqual([]);
  });

  it("a cash sale of two products stays within its budget", async () => {
    const a = create();
    const b = create();
    await Promise.all([a.result, b.result]);
    // Warm up once, then measure.
    const sell = () =>
      runOnlineCommand(mongo, actor(), {
        operationId: randomUUID(),
        type: "sale.create",
        input: {
          id: randomUUID(),
          lines: [lineFor(a.id), lineFor(b.id)],
          discount: 0,
          tendered: 10_000,
          paymentMethod: "cash",
          notes: "",
        },
      });
    await sell();
    const seen = await commandsOf(async () => {
      const result = await sell();
      expect(result.ok).toBe(true);
    });
    expect(seen).not.toContain("createIndexes");
    // 11 today: the "already done?" check, then the transaction (products, number counter, the
    // sale's id check, the shop's change counter, the sale, its stock movements, one bulk stock
    // update and its read-back, the "done" record) and its commit. It was about 15 and went up with
    // every line in the cart.
    expect(seen.length).toBeLessThanOrEqual(11);
  });

  it("creating a product stays within its budget", async () => {
    await create().result;
    const seen = await commandsOf(async () => {
      const result = await create().result;
      expect(result.ok).toBe(true);
    });
    // The "already done?" check, the code-in-use check (a typed SKU or barcode), then the
    // transaction: the product, its opening stock movement, the shop's change counter, the "done"
    // record, and the commit.
    expect(seen.length).toBeLessThanOrEqual(8);
  });
});
