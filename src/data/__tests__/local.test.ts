import "fake-indexeddb/auto";
import { beforeAll, describe, expect, it } from "vitest";
import { StoreDB } from "@/db/local/db";
import { newId } from "@/lib/ids";
import { derivedSearchFields } from "@/lib/search-fields";
import {
  buildFixture,
  CASES,
  type Doc,
  TOTAL_CASES,
} from "../../../tests/helpers/list-fixture";
import { localList, localLookup, localRecord, localTotals } from "../local";
import {
  type ListParamsInput,
  matches,
  parseListParams,
  type Resource,
  referenceList,
  referenceTotals,
} from "../spec";

/**
 * The device's lists must give the same records in the same order as the plain rules, with the same
 * data and the same questions the server is tested with (see src/server/data/__tests__/list.test.ts).
 */
const TZ = "Asia/Dhaka";
let db: StoreDB;
const wire: Record<string, Doc[]> = {};

beforeAll(async () => {
  db = new StoreDB(`local-list-${newId()}`);
  for (const { resource, shop, doc } of buildFixture()) {
    if (shop !== "main") continue; // another shop's records are never on this device
    wire[resource] = [...(wire[resource] ?? []), doc];
    // A device keeps its own search fields with each record, as it does after a pull.
    const withFields = [
      "products",
      "customers",
      "suppliers",
      "sales",
      "purchases",
    ].includes(resource)
      ? { ...doc, ...derivedSearchFields(resource as "products", doc) }
      : doc;
    if (resource === "sales") {
      const { items, ...sale } = withFields as Doc & { items: Doc[] };
      await db.sales.put(sale as never);
      await db.saleItems.bulkPut(
        items.map((i) => ({
          ...i,
          saleId: doc.id,
          createdAt: doc.createdAt,
        })) as never,
      );
    } else if (resource === "purchases") {
      const { items: _items, ...purchase } = withFields as Doc & {
        items: Doc[];
      };
      await db.purchases.put(purchase as never);
    } else await db.table(resource).put(withFields);
  }
});

const ask = (resource: Resource, input: ListParamsInput<Resource>) =>
  parseListParams(resource, input);

async function collect(
  resource: Resource,
  input: ListParamsInput<Resource>,
  step: number,
) {
  const params = ask(resource, input);
  // Growing the window like "load more" does: ask for 7, then 14, then 21, ...
  let limit = step;
  for (let guard = 0; guard < 400; guard++) {
    const page = await localList(db, resource, params, limit, TZ);
    if (page.total <= limit) return page.items.map((d) => String(d.id));
    limit += step;
  }
  throw new Error("never finished");
}

describe("the device's lists match the plain rules", () => {
  for (const [resource, input] of CASES) {
    it(`${resource} ${JSON.stringify(input)}`, async () => {
      const expected = referenceList(
        resource,
        wire[resource] ?? [],
        ask(resource, input),
      ).map((d) => String(d.id));
      expect(await collect(resource, input, 7)).toEqual(expected);
      // A window is the front of the full answer, whatever its size.
      const window = await localList(
        db,
        resource,
        ask(resource, input),
        10,
        TZ,
      );
      expect(window.items.map((d) => String(d.id))).toEqual(
        expected.slice(0, 10),
      );
      expect(window.total).toBe(expected.length);
    });
  }
});

describe("header totals", () => {
  for (const [resource, input] of TOTAL_CASES) {
    it(`${resource} ${JSON.stringify(input)}`, async () => {
      const params = ask(resource, input);
      const matching = (wire[resource] ?? []).filter((d) =>
        matches(resource, d, params),
      );
      expect(await localTotals(db, resource, params, TZ)).toEqual(
        referenceTotals(resource, matching),
      );
    });
  }
});

describe("one record and lookups", () => {
  it("a sale comes with its lines, in order", async () => {
    const got = await localRecord(db, "sales", "s0001");
    expect(got?.record.id).toBe("s0001");
    expect((got?.record.items as Doc[] | undefined)?.length).toBe(1);
    expect(got?.extra.returns).toEqual([]);
    expect(await localRecord(db, "sales", "nope")).toBeNull();
  });

  it("a product comes with its stock history, newest first", async () => {
    const got = await localRecord(db, "products", "p001");
    const history = got?.extra.stockMovements ?? [];
    expect(history.length).toBeGreaterThan(0);
    const times = history.map((m) => String(m.createdAt));
    expect(times).toEqual([...times].sort().reverse());
  });

  it("a person comes with a statement slot (empty here: the fixture has no ledger)", async () => {
    const got = await localRecord(db, "customers", "c001");
    expect(got?.extra.ledgerEntries).toEqual([]);
  });

  it("looks a product up by barcode or SKU, active ones only", async () => {
    expect((await localLookup(db, "8901003"))?.id).toBe("p003");
    expect((await localLookup(db, "A0004"))?.id).toBe("p003");
    expect(await localLookup(db, "nothing")).toBeNull();
    expect(await localLookup(db, "DEL")).toBeNull();
    expect(await localLookup(db, "")).toBeNull();
  });
});
