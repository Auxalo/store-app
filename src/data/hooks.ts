"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CommandArgs, CommandType } from "@/commands/definitions";
import { getLocalDb } from "@/db/local/db";
import { findDuplicateCode } from "@/db/local/queries/products";
import type {
  Category,
  Customer,
  Expense,
  Payment,
  Product,
  Purchase,
  ReturnDoc,
  Sale,
  StockMovement,
  Supplier,
} from "@/db/local/types";
import { newId } from "@/lib/ids";
import type { WireChange } from "@/schemas/sync";
import { usePreferences } from "@/stores/preferences";
import { syncNow } from "@/sync/manager";
import { useCommands } from "@/sync/use-commands";
import { DataError } from "./errors";
import { localList, localLookup, localRecord, localTotals } from "./local";
import { useDataModeStore } from "./mode-store";
import {
  fetchAll,
  fetchLookup,
  fetchPage,
  fetchRecord,
  fetchTotals,
  postCommand,
} from "./online";
import {
  type ListParams,
  type ListParamsInput,
  parseListParams,
  type Resource,
} from "./spec";

/**
 * One way for screens to read and write, whichever way this device gets its data:
 *   offline mode : from the copy of the shop on the device (live: updates as soon as anything changes)
 *   online mode  : from the server, a page at a time, searched and sorted there
 * A screen asks the same question and gets the same shape of answer either way.
 *
 * Both halves are always called (React needs hooks in a fixed order); the one that does not apply
 * to the current mode is switched off.
 */

export interface RecordOf {
  products: Product;
  customers: Customer;
  suppliers: Supplier;
  sales: Sale;
  purchases: Purchase;
  expenses: Expense;
  payments: Payment;
  returns: ReturnDoc;
  stockMovements: StockMovement;
}

export type ListStatus = "loading" | "ready" | "error";

export interface ListResult<T> {
  items: T[];
  status: ListStatus;
  error?: DataError;
  /** There are more records than are shown. */
  hasMore: boolean;
  loadMore: () => void;
  isLoadingMore: boolean;
  /** Online: showing the previous answer while a new one loads (typing in the search box). */
  isRefreshing: boolean;
  refetch: () => void;
}

const DEFAULT_PAGE = 50;

const stableKey = (value: unknown) => JSON.stringify(value);

function useMode() {
  return useDataModeStore((s) => s.mode);
}

/** A list, searched, filtered and sorted by the rules in spec.ts. */
export function useList<R extends Resource>(
  resource: R,
  input: ListParamsInput<R>,
  options: { pageSize?: number; enabled?: boolean } = {},
): ListResult<RecordOf[R]> {
  const mode = useMode();
  const timeZone = usePreferences((s) => s.timeZone);
  const pageSize = options.pageSize ?? DEFAULT_PAGE;
  const enabled = options.enabled ?? true;

  const key = stableKey(input);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the stable form of `input`
  const params = useMemo(
    () => parseListParams(resource, input),
    [resource, key],
  );
  const paramsKey = stableKey(params);

  // --- on the device ---
  const [limit, setLimit] = useState(pageSize);
  // biome-ignore lint/correctness/useExhaustiveDependencies: start from the first page when the question changes
  useEffect(() => setLimit(pageSize), [resource, paramsKey, pageSize]);
  const local = useLiveQuery(
    () =>
      mode === "offline" && enabled
        ? localList(
            getLocalDb(),
            resource,
            params as ListParams<Resource>,
            limit,
            timeZone,
          )
        : undefined,
    [mode, enabled, resource, paramsKey, limit, timeZone],
  );

  // --- from the server ---
  const online = useInfiniteQuery({
    queryKey: ["data", "list", resource, paramsKey, pageSize],
    enabled: mode === "online" && enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      fetchPage(resource, params as ListParams<Resource>, pageParam, pageSize),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });

  const onlineItems = useMemo(() => {
    const seen = new Set<string>();
    const items: Record<string, unknown>[] = [];
    for (const page of online.data?.pages ?? [])
      for (const item of page.items) {
        const id = String(item.id);
        if (seen.has(id)) continue; // a record can move between pages while someone scrolls
        seen.add(id);
        items.push(item);
      }
    return items;
  }, [online.data]);

  if (mode === "online") {
    return {
      items: onlineItems as unknown as RecordOf[R][],
      status: online.isPending ? "loading" : online.isError ? "error" : "ready",
      error:
        online.error instanceof DataError
          ? online.error
          : online.error
            ? new DataError("UNKNOWN", 0)
            : undefined,
      hasMore: online.hasNextPage ?? false,
      loadMore: () => {
        if (online.hasNextPage && !online.isFetchingNextPage)
          void online.fetchNextPage();
      },
      isLoadingMore: online.isFetchingNextPage,
      isRefreshing: online.isPlaceholderData,
      refetch: () => void online.refetch(),
    };
  }
  return {
    items: (local?.items ?? []) as unknown as RecordOf[R][],
    status: local ? "ready" : "loading",
    hasMore: local ? local.total > limit : false,
    loadMore: () => setLimit((l) => l + pageSize),
    isLoadingMore: false,
    isRefreshing: false,
    refetch: () => undefined, // live: nothing to re-ask
  };
}

/** Counts and sums over everything a list matches (its header), not just the page on screen. */
export function useTotals<R extends Resource>(
  resource: R,
  input: ListParamsInput<R>,
  options: { enabled?: boolean } = {},
): Record<string, number> | undefined {
  const mode = useMode();
  const timeZone = usePreferences((s) => s.timeZone);
  const enabled = options.enabled ?? true;
  const key = stableKey(input);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the stable form of `input`
  const params = useMemo(
    () => parseListParams(resource, input),
    [resource, key],
  );
  const paramsKey = stableKey(params);

  const local = useLiveQuery(
    () =>
      mode === "offline" && enabled
        ? localTotals(
            getLocalDb(),
            resource,
            params as ListParams<Resource>,
            timeZone,
          )
        : undefined,
    [mode, enabled, resource, paramsKey, timeZone],
  );
  const online = useQuery({
    queryKey: ["data", "totals", resource, paramsKey],
    enabled: mode === "online" && enabled,
    queryFn: () => fetchTotals(resource, params as ListParams<Resource>),
    placeholderData: keepPreviousData,
  });
  return mode === "online" ? online.data : local;
}

export interface RecordResult<T> {
  record?: T;
  /** Related records: returns of a sale, a product's stock history, a person's statement, ... */
  extra: Record<string, Array<Record<string, unknown>>>;
  status: "loading" | "ready" | "missing" | "error";
  error?: DataError;
}

/** One record with what its own screen needs. */
export function useRecord<R extends Resource, T = RecordOf[R]>(
  resource: R,
  id: string | null | undefined,
): RecordResult<T> {
  const mode = useMode();
  const enabled = !!id;
  const local = useLiveQuery(
    async () =>
      mode === "offline" && id
        ? ((await localRecord(getLocalDb(), resource, id)) ?? null)
        : undefined,
    [mode, resource, id],
  );
  const online = useQuery({
    queryKey: ["data", "record", resource, id],
    enabled: mode === "online" && enabled,
    queryFn: () => fetchRecord(resource, id as string),
    retry: (count, error) =>
      !(error instanceof DataError && error.status === 404) && count < 2,
  });

  if (!id) return { extra: {}, status: "missing" };
  if (mode === "online") {
    if (online.isPending) return { extra: {}, status: "loading" };
    if (online.isError) {
      const error =
        online.error instanceof DataError
          ? online.error
          : new DataError("UNKNOWN", 0);
      return {
        extra: {},
        status: error.status === 404 ? "missing" : "error",
        error,
      };
    }
    return {
      record: online.data.record as unknown as T,
      extra: online.data.extra,
      status: "ready",
    };
  }
  if (local === undefined) return { extra: {}, status: "loading" };
  if (local === null) return { extra: {}, status: "missing" };
  return {
    record: local.record as unknown as T,
    extra: local.extra,
    status: "ready",
  };
}

/** A scanned or typed barcode or SKU → the active product it belongs to, or null. */
export function useProductLookup() {
  return useCallback(async (code: string): Promise<Product | null> => {
    const mode = useDataModeStore.getState().mode;
    const found =
      mode === "online"
        ? await fetchLookup(code)
        : await localLookup(getLocalDb(), code);
    return (found as unknown as Product | null) ?? null;
  }, []);
}

export interface CommandOutcome {
  operationId: string;
  /** Online: the records that changed (a sale with its number, for example). */
  docs?: WireChange[];
}

export interface RunOptions {
  /** For edits and deletes: the version of the record the person was looking at. */
  baseVersion?: number;
  /** Reuse the same id when retrying, so one tap is never applied twice. */
  operationId?: string;
}

/**
 * Saves something a person did. Offline mode saves on the device at once and sends it later;
 * online mode asks the server, and rejects with a `DataError` (OFFLINE, FORBIDDEN, CONFLICT, ...)
 * if it was not saved. Either way the lists on screen refresh by themselves.
 */
export function useCommand() {
  const runLocal = useCommands();
  const client = useQueryClient();

  return useCallback(
    async <T extends CommandType>(
      type: T,
      input: CommandArgs<T>,
      options: RunOptions = {},
    ): Promise<CommandOutcome> => {
      if (useDataModeStore.getState().mode !== "online")
        return runLocal(type, input);
      // Changes made before this device went online go first, so everything reaches the shop in
      // the order it happened. If they cannot be sent yet, nothing new is saved either.
      await sendLeftovers();
      const operationId = options.operationId ?? newId();
      const result = await postCommand({
        operationId,
        type,
        input,
        baseVersion: options.baseVersion,
      });
      await client.invalidateQueries({ queryKey: ["data"] });
      return { operationId, docs: result.docs };
    },
    [runLocal, client],
  );
}

const waiting = () =>
  getLocalDb().outbox.where("status").anyOf("pending", "syncing").count();

async function sendLeftovers() {
  if ((await waiting()) === 0) return;
  await syncNow();
  if ((await waiting()) > 0) throw new DataError("OFFLINE", 0);
}

/** Categories, A-Z. A small list: it comes whole in either mode. */
export function useCategories(): Category[] | undefined {
  const mode = useMode();
  const local = useLiveQuery(
    async () =>
      mode === "offline"
        ? await getLocalDb()
            .categories.filter((c) => !c.deletedAt)
            .sortBy("name")
        : undefined,
    [mode],
  );
  const online = useQuery({
    queryKey: ["data", "categories"],
    enabled: mode === "online",
    queryFn: () => fetchAll("categories"),
  });
  const onlineList = useMemo(
    () =>
      online.data
        ? ([...online.data] as unknown as Category[]).sort((a, b) =>
            a.name.localeCompare(b.name),
          )
        : undefined,
    [online.data],
  );
  return mode === "online" ? onlineList : local;
}

/** Is a barcode or SKU already used by another product? (Active or not, but not deleted.) */
export function useDuplicateCodeCheck() {
  return useCallback(
    async (
      field: "barcode" | "sku",
      value: string,
      ignoreId?: string,
    ): Promise<{ name: string } | null> => {
      const code = value.trim();
      if (!code) return null;
      if (useDataModeStore.getState().mode === "online") {
        const page = await fetchPage(
          "products",
          parseListParams("products", { q: code, active: "all" }),
          null,
          10,
        );
        const hit = page.items.find(
          (p) => p[field] === code && p.id !== ignoreId,
        );
        return hit ? { name: String(hit.name) } : null;
      }
      return (
        (await findDuplicateCode(getLocalDb(), field, code, ignoreId)) ?? null
      );
    },
    [],
  );
}
