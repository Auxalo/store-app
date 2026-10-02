import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ListParamsInput,
  matches,
  parseListParams,
  type Resource,
  referenceList,
  referenceTotals,
} from "@/data/spec";
import { derivedSearchFields } from "@/lib/search-fields";
import {
  buildFixture,
  CASES,
  TOTAL_CASES,
} from "../../../../tests/helpers/list-fixture";
import { startMongo, type TestMongo } from "../../../../tests/helpers/mongo";
import { toWire } from "../../commands/master-data";
import {
  BadCursorError,
  COLLECTION,
  getRecord,
  listResource,
  lookupProduct,
  type Page,
  stockSummary,
  totalsOf,
  type Viewer,
} from "../service";

/**
 * The server's lists must give the same records in the same order as the plain rules in
 * src/data/spec.ts, page by page. The data is made up to hit the awkward cases: Bangla and English
 * names, ties, deleted and inactive records, dates around midnight in Dhaka, another shop's data.
 */
let mongo: TestMongo;
let storeId: string;
let otherStore: string;

type Doc = Record<string, unknown>;
const docs: Record<string, Doc[]> = {};

const viewer = (canSeeCost = true): Viewer => ({ storeId, canSeeCost });

async function collect(
  resource: Resource,
  input: ListParamsInput<Resource>,
  limit = 7,
): Promise<string[]> {
  const params = parseListParams(resource, input);
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 200; guard++) {
    const page: Page = await listResource(
      mongo.db,
      resource,
      params,
      viewer(),
      { limit, cursor },
    );
    ids.push(...page.items.map((d) => d.id));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return ids;
}

const reference = (resource: Resource, input: ListParamsInput<Resource>) =>
  referenceList(
    resource,
    docs[resource] ?? [],
    parseListParams(resource, input),
  ).map((d) => String(d.id));

beforeAll(async () => {
  mongo = await startMongo();
  storeId = await mongo.seedStore();
  otherStore = await mongo.seedStore("Other");

  for (const { resource, shop, doc } of buildFixture()) {
    const store = shop === "main" ? storeId : otherStore;
    const stored: Doc = {
      _id: doc.id,
      storeId: store,
      version: 1,
      fieldVersions: {},
      syncSeq: 1,
      ...doc,
    };
    delete stored.id;
    if (
      ["products", "customers", "suppliers", "sales", "purchases"].includes(
        resource,
      )
    )
      Object.assign(
        stored,
        derivedSearchFields(resource as "products", stored),
      );
    await mongo.db.collection(COLLECTION[resource]).insertOne(stored as never);
    if (shop === "main") {
      docs[resource] ??= [];
      docs[resource].push(toWire(stored as never) as unknown as Doc);
    }
  }
}, 180_000);

afterAll(async () => {
  await mongo?.stop();
});

describe("the server's lists match the plain rules, page by page", () => {
  for (const [resource, input] of CASES) {
    it(`${resource} ${JSON.stringify(input)}`, async () => {
      const expected = reference(resource, input);
      expect(await collect(resource, input, 7)).toEqual(expected);
      // The answer does not depend on how big the pages are.
      expect(await collect(resource, input, 50)).toEqual(expected);
    });
  }

  it("covers a meaningful spread (the cases are not all empty)", async () => {
    const sizes = await Promise.all(
      CASES.map(([r, i]) => collect(r, i, 50).then((x) => x.length)),
    );
    expect(sizes.filter((n) => n > 0).length).toBeGreaterThan(
      CASES.length * 0.85,
    );
    expect(Math.max(...sizes)).toBeGreaterThan(50); // several pages were really walked
  });
});

describe("header totals cover everything that matches, not one page", () => {
  for (const [resource, input] of TOTAL_CASES) {
    it(`${resource} ${JSON.stringify(input)}`, async () => {
      const params = parseListParams(resource, input);
      const matching = (docs[resource] ?? []).filter((d) =>
        matches(resource, d, params),
      );
      expect(await totalsOf(mongo.db, resource, params, viewer())).toEqual(
        referenceTotals(resource, matching),
      );
    });
  }
});

describe("what a person may see", () => {
  it("hides purchase prices and the cost of sold goods from people who may not see cost", async () => {
    const products = await listResource(
      mongo.db,
      "products",
      parseListParams("products", {}),
      viewer(false),
      { limit: 5 },
    );
    for (const p of products.items)
      expect(p).not.toHaveProperty("purchasePrice");
    const owner = await listResource(
      mongo.db,
      "products",
      parseListParams("products", {}),
      viewer(true),
      { limit: 5 },
    );
    for (const p of owner.items) expect(p).toHaveProperty("purchasePrice");

    const linesOf = async (canSeeCost: boolean) =>
      (
        (await getRecord(mongo.db, "sales", "s0001", viewer(canSeeCost)))
          ?.record as unknown as { items?: Doc[] } | undefined
      )?.items ?? [];
    const hidden = await linesOf(false);
    expect(hidden.length).toBeGreaterThan(0);
    for (const item of hidden) expect(item).not.toHaveProperty("unitCost");
    const shown = await linesOf(true);
    expect(shown[0]).toHaveProperty("unitCost");
    expect((await stockSummary(mongo.db, viewer(false))).costValue).toBe(0);
    expect(
      (await stockSummary(mongo.db, viewer(true))).costValue,
    ).toBeGreaterThan(0);
  });

  it("never shows another shop's records, deleted records, or internal fields", async () => {
    const all = await collect("products", { active: "all" }, 100);
    expect(all).not.toContain("p-other");
    expect(all).not.toContain("p-deleted");
    expect(
      await getRecord(mongo.db, "products", "p-other", viewer()),
    ).toBeNull();
    const page = await listResource(
      mongo.db,
      "sales",
      parseListParams("sales", {}),
      viewer(),
      { limit: 3 },
    );
    for (const sale of page.items) {
      expect(sale).not.toHaveProperty("searchWords");
      expect(sale).not.toHaveProperty("fieldVersions");
      expect(sale).not.toHaveProperty("items"); // lists leave the lines out
    }
  });

  it("a list row has no lines, but the record's own page has them (and its returns)", async () => {
    const got = await getRecord(mongo.db, "sales", "s0001", viewer());
    expect(got?.record).toMatchObject({ id: "s0001" });
    expect(got?.extra.returns).toEqual([]);
    const person = await getRecord(mongo.db, "customers", "c001", viewer());
    expect(person?.extra).toHaveProperty("ledgerEntries");
    const product = await getRecord(mongo.db, "products", "p001", viewer());
    expect(product?.extra.stockMovements.length).toBeGreaterThan(0);
  });
});

describe("paging", () => {
  it("refuses a page marker that belongs to a different search", async () => {
    const first = await listResource(
      mongo.db,
      "sales",
      parseListParams("sales", {}),
      viewer(),
      { limit: 5 },
    );
    expect(first.nextCursor).toBeTruthy();
    await expect(
      listResource(
        mongo.db,
        "sales",
        parseListParams("sales", { status: "voided" }),
        viewer(),
        { limit: 5, cursor: first.nextCursor },
      ),
    ).rejects.toBeInstanceOf(BadCursorError);
    await expect(
      listResource(mongo.db, "sales", parseListParams("sales", {}), viewer(), {
        limit: 5,
        cursor: "not-a-cursor",
      }),
    ).rejects.toBeInstanceOf(BadCursorError);
  });

  it("a record added while someone is scrolling does not repeat or skip anything already behind them", async () => {
    const params = parseListParams("sales", { sort: "newest" });
    const first = await listResource(mongo.db, "sales", params, viewer(), {
      limit: 10,
    });
    await mongo.db.collection("sales").insertOne({
      _id: "s-late" as never,
      storeId,
      deletedAt: null,
      invoiceNo: "A-2609-9999",
      status: "active",
      paymentMethod: "cash",
      total: 1,
      due: 0,
      createdAt: "2026-09-29T23:59:59.000Z",
      searchWords: ["a", "2609", "9999"],
    } as never);
    const second = await listResource(mongo.db, "sales", params, viewer(), {
      limit: 10,
      cursor: first.nextCursor,
    });
    const seen = new Set(first.items.map((d) => d.id));
    for (const item of second.items) expect(seen.has(item.id)).toBe(false);
    await mongo.db.collection("sales").deleteOne({ _id: "s-late" as never });
  });
});

describe("barcode lookup", () => {
  it("finds the one active product by barcode or SKU, and nothing for other codes or shops", async () => {
    expect((await lookupProduct(mongo.db, "8901003", viewer()))?.id).toBe(
      "p003",
    );
    expect((await lookupProduct(mongo.db, "A0004", viewer()))?.id).toBe("p003");
    expect(await lookupProduct(mongo.db, "nope", viewer())).toBeNull();
    expect(await lookupProduct(mongo.db, "O1", viewer())).toBeNull();
    expect(await lookupProduct(mongo.db, "DEL", viewer())).toBeNull();
    expect(await lookupProduct(mongo.db, "", viewer())).toBeNull();
  });
});
