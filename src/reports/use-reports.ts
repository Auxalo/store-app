"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { type ListResult, useList, useTotals } from "@/data/hooks";
import { useDataMode } from "@/data/mode-store";
import { getLocalDb } from "@/db/local/db";
import type { Customer, Product, Supplier } from "@/db/local/types";
import { usePreferences } from "@/stores/preferences";
import type { DayRange } from "./compute";
import { loadStock } from "./local";
import type { MovementSummary } from "./movements";
import { loadMovementSummary } from "./movements-local";

export interface StockHeader {
  costValue: number;
  retailValue: number;
  lowCount: number;
  outCount: number;
}

/** What the stock is worth and how much is low or out: from this device, or from the server. */
export function useStockHeader(enabled = true): StockHeader | undefined {
  const mode = useDataMode();
  const local = useLiveQuery(
    async () =>
      mode === "offline" && enabled ? loadStock(getLocalDb()) : undefined,
    [mode, enabled],
  );
  const online = useQuery({
    queryKey: ["data", "stock-summary"],
    enabled: mode === "online" && enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/reports/stock", { signal });
      if (!response.ok) throw new Error(String(response.status));
      return ((await response.json()) as { summary: StockHeader }).summary;
    },
  });
  return mode === "online" ? online.data : local;
}

export interface DuesReport {
  customerTotal: number;
  supplierTotal: number;
  /** How many people owe, and how many are owed. */
  customerCount: number;
  supplierCount: number;
  /** Paid ahead (an advance), by customers and to suppliers. */
  customerAdvance: number;
  supplierAdvance: number;
  customers: ListResult<Customer>;
  suppliers: ListResult<Supplier>;
  /** Both lists and both totals are known. */
  ready: boolean;
}

/** Who owes us and whom we owe, biggest first. The totals cover everyone, not just the page shown. */
export function useDues(enabled = true, q = ""): DuesReport {
  const params = { balance: "owes", sort: "balance", dir: "desc" } as const;
  // The lists can be searched by name or phone; the totals always cover everyone.
  const customers = useList(
    "customers",
    { ...params, q },
    { pageSize: 100, enabled },
  );
  const suppliers = useList(
    "suppliers",
    { ...params, q },
    { pageSize: 100, enabled },
  );
  const customerTotals = useTotals("customers", params, { enabled });
  const supplierTotals = useTotals("suppliers", params, { enabled });
  const customerAdvance = useTotals(
    "customers",
    { balance: "advance" },
    { enabled },
  );
  const supplierAdvance = useTotals(
    "suppliers",
    { balance: "advance" },
    { enabled },
  );
  return {
    customerTotal: customerTotals?.owed ?? 0,
    supplierTotal: supplierTotals?.owed ?? 0,
    customerCount: customerTotals?.count ?? 0,
    supplierCount: supplierTotals?.count ?? 0,
    customerAdvance: customerAdvance?.advance ?? 0,
    supplierAdvance: supplierAdvance?.advance ?? 0,
    customers,
    suppliers,
    ready:
      customers.status !== "loading" &&
      suppliers.status !== "loading" &&
      !!customerTotals &&
      !!supplierTotals &&
      !!customerAdvance &&
      !!supplierAdvance,
  };
}

/** Products for the stock report (all, or only those low or out), A-Z. */
export function useStockProducts(
  onlyLow: boolean,
  enabled = true,
): ListResult<Product> {
  return useList(
    "products",
    { stock: onlyLow ? "low" : "all", active: "active", sort: "name" },
    { pageSize: 100, enabled },
  );
}

/** What went in and out of stock per product in a range: from this device, or from the server. */
export function useMovementSummary(
  range: DayRange,
  enabled = true,
): MovementSummary | undefined {
  const mode = useDataMode();
  const timeZone = usePreferences((s) => s.timeZone);
  const local = useLiveQuery(
    async () =>
      mode === "offline" && enabled
        ? loadMovementSummary(getLocalDb(), range, timeZone)
        : undefined,
    [mode, enabled, range.from, range.to, timeZone],
  );
  const online = useQuery({
    queryKey: ["data", "movement-summary", range.from, range.to],
    enabled: mode === "online" && enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/reports/movements?from=${range.from}&to=${range.to}`,
        { signal },
      );
      if (!response.ok) throw new Error(String(response.status));
      return ((await response.json()) as { summary: MovementSummary }).summary;
    },
  });
  return mode === "online" ? online.data : local;
}
