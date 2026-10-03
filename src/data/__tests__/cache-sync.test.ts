import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import type { WireChange } from "@/schemas/sync";
import { applyResultToCache } from "../cache-sync";
import {
  forgetHead,
  getLastHead,
  noteOwnWrite,
  onHeadChange,
  setHead,
} from "../head";

const change = (collection: string, id: string, extra = {}): WireChange =>
  ({ collection, doc: { id, syncSeq: 1, ...extra } }) as never;

let client: QueryClient;
const fetched: string[] = [];

/** A query that records when it is asked, so we can see which ones a save refreshes. */
function watch(key: string[], label: string) {
  void client.prefetchQuery({
    queryKey: key,
    queryFn: async () => {
      fetched.push(label);
      return label;
    },
    staleTime: 60_000,
  });
}

beforeEach(async () => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetched.length = 0;
  // Mount observers so the queries count as "active".
  for (const [key, label] of [
    [["data", "list", "sales", "{}", "50"], "sales list"],
    [["data", "list", "expenses", "{}", "50"], "expenses list"],
    [["data", "list", "products", "{}", "50"], "products list"],
    [["data", "totals", "customers", "{}"], "customers totals"],
    [["data", "summary", "2026-10-01", "2026-10-02"], "summary"],
    [["data", "categories"], "categories"],
  ] as const) {
    client
      .getQueryCache()
      .build(client, { queryKey: [...key], queryFn: async () => label });
    client
      .getQueryCache()
      .find({ queryKey: [...key] })
      ?.setData(label);
    client
      .getQueryCache()
      .find({ queryKey: [...key] })
      ?.addObserver({
        options: {
          queryKey: [...key],
          queryFn: async () => {
            fetched.push(label);
            return label;
          },
        },
        onQueryUpdate: () => undefined,
        shouldFetchOnReconnect: () => false,
        shouldFetchOnWindowFocus: () => false,
        isStale: () => true,
        getCurrentResult: () => ({}) as never,
        setOptions: () => undefined,
        listeners: new Set(),
        destroy: () => undefined,
      } as never);
  }
  void watch;
});

describe("applyResultToCache", () => {
  it("puts the returned records into the cache, so a receipt can show at once", () => {
    applyResultToCache(client, [
      change("sales", "s1", { total: 5000, items: [{ id: "i" }] }),
    ]);
    const cached = client.getQueryData<{ record: { total: number } }>([
      "data",
      "record",
      "sales",
      "s1",
    ]);
    expect(cached?.record.total).toBe(5000);
  });

  it("keeps what a record's page already had (its related rows) while replacing the record", () => {
    client.setQueryData(["data", "record", "products", "p1"], {
      record: { id: "p1", name: "Old", stock: 5 },
      extra: { stockMovements: [{ id: "m1" }] },
    });
    applyResultToCache(client, [
      change("products", "p1", { name: "New", stock: 4 }),
    ]);
    const cached = client.getQueryData<{
      record: { name: string };
      extra: { stockMovements: unknown[] };
    }>(["data", "record", "products", "p1"]);
    expect(cached?.record.name).toBe("New");
    expect(cached?.extra.stockMovements).toHaveLength(1);
  });

  it("marks only what the save touched as out of date (a sale does not touch expenses)", () => {
    applyResultToCache(client, [
      change("sales", "s1"),
      change("products", "p1"),
    ]);
    const stale = (key: string[]) => client.getQueryState(key)?.isInvalidated;
    expect(stale(["data", "list", "sales", "{}", "50"])).toBe(true);
    expect(stale(["data", "list", "products", "{}", "50"])).toBe(true);
    expect(stale(["data", "summary", "2026-10-01", "2026-10-02"])).toBe(true);
    expect(stale(["data", "list", "expenses", "{}", "50"])).toBeFalsy();
    expect(stale(["data", "totals", "customers", "{}"])).toBeFalsy();
    expect(stale(["data", "categories"])).toBeFalsy();
  });

  it("a customer's balance change refreshes the customers' totals", () => {
    applyResultToCache(client, [change("customers", "c1")]);
    expect(
      client.getQueryState(["data", "totals", "customers", "{}"])
        ?.isInvalidated,
    ).toBe(true);
  });
});

describe("the shop's change counter", () => {
  beforeEach(forgetHead);

  it("is not news when the only thing that moved it was this browser's own save", () => {
    const heard: number[] = [];
    const stop = onHeadChange((h) => heard.push(h));
    setHead(100); // first answer: never news
    expect(getLastHead()).toBe(100);
    noteOwnWrite(103, 3); // we made 3 changes and nobody else did
    setHead(103); // the next check agrees: nothing to refresh
    expect(heard).toEqual([]);
    stop();
  });

  it("is news when someone else saved in between", () => {
    const heard: number[] = [];
    const stop = onHeadChange((h) => heard.push(h));
    setHead(200);
    noteOwnWrite(205, 3); // 5 moved but we only account for 3: someone else saved 2
    setHead(205);
    expect(heard).toEqual([205]);
    stop();
  });
});
