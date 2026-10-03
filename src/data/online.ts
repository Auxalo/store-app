import { ingestStamp } from "@/billing/client";
import type { BillingView, PaymentView } from "@/billing/plans";
import type { BillingStamp } from "@/billing/state";
import { getLocalDb } from "@/db/local/db";
import type { WireChange } from "@/schemas/sync";
import { useActiveUser } from "@/stores/active-user";
import { giveDeviceNewIdentity, registerDevice } from "@/sync/register-device";
import { useSyncStore } from "@/sync/store";
import { DataError } from "./errors";
import type { ListParams, Resource } from "./spec";

/** Asking the server directly (online mode). Every failure becomes a `DataError` a screen can act on. */
async function request<T>(
  path: string,
  init?: RequestInit,
  retried = false,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new DataError("OFFLINE", 0);
  }
  // A brand-new device asks before it has been registered with the shop: register, then ask again.
  // (WRONG_STORE: this browser still has the device of the shop that used it before.)
  if ((response.status === 401 || response.status === 403) && !retried) {
    const peek = (await response
      .clone()
      .json()
      .catch(() => ({}))) as {
      code?: string;
    };
    // (DEVICE_UNKNOWN from the data endpoints, DEVICE_MISSING from the sync ones such as head.)
    if (
      peek.code === "DEVICE_UNKNOWN" ||
      peek.code === "DEVICE_MISSING" ||
      peek.code === "WRONG_STORE"
    ) {
      try {
        const db = getLocalDb();
        try {
          await registerDevice(db);
        } catch (error) {
          // The identity belongs to the other shop: use a new one, once.
          if (peek.code !== "WRONG_STORE") throw error;
          await giveDeviceNewIdentity(db);
          await registerDevice(db);
        }
        return request<T>(path, init, true);
      } catch {
        /* fall through to the original answer */
      }
    }
  }
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    docs?: WireChange[];
    waitMs?: number;
    freeLeft?: number;
    billing?: BillingStamp;
  };
  if (!response.ok) {
    // The subscription is overdue: the device learns it here and every screen goes to billing.
    if (body.code === "BILLING_DUE") void ingestStamp(body.billing);
    // The operator has paused this shop: the app shows who to contact instead of its screens.
    if (body.code === "SHOP_SUSPENDED")
      useSyncStore.getState().patch({ problem: "suspended" });
    // The server does not know who is working (no PIN entered on this device): ask for the PIN.
    if (body.code === "PIN_REQUIRED" && !useActiveUser.getState().locked)
      useActiveUser.getState().lock();
    throw new DataError(
      body.code ?? `HTTP_${response.status}`,
      response.status,
      body.docs,
      { waitMs: body.waitMs, freeLeft: body.freeLeft },
    );
  }
  return body as T;
}

/** List params as a query string: only what is set (empty and false mean "not filtered"). */
export function toQuery(
  params: Record<string, unknown>,
  extra: Record<string, string | number | null | undefined> = {},
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...extra })) {
    if (
      value === undefined ||
      value === null ||
      value === "" ||
      value === false
    )
      continue;
    search.set(key, String(value));
  }
  return search.toString();
}

export interface OnlinePage<T = Record<string, unknown>> {
  items: T[];
  nextCursor: string | null;
}

export const fetchPage = (
  resource: Resource,
  params: ListParams<Resource>,
  cursor: string | null,
  limit: number,
  signal?: AbortSignal,
) =>
  request<OnlinePage>(
    `/api/data/${resource}?${toQuery(params, { cursor, limit })}`,
    { signal },
  );

export const fetchTotals = (
  resource: Resource,
  params: ListParams<Resource>,
  signal?: AbortSignal,
) =>
  request<{ totals: Record<string, number> }>(
    `/api/data/${resource}/totals?${toQuery(params)}`,
    { signal },
  ).then((r) => r.totals);

export const fetchRecord = (
  resource: Resource,
  id: string,
  signal?: AbortSignal,
) =>
  request<{
    record: Record<string, unknown>;
    extra: Record<string, Array<Record<string, unknown>>>;
  }>(`/api/data/${resource}/${encodeURIComponent(id)}`, { signal });

export const fetchLookup = (code: string) =>
  request<{ product: Record<string, unknown> | null }>(
    `/api/data/products/lookup?code=${encodeURIComponent(code)}`,
  ).then((r) => r.product);

/** Small lists that come back whole: categories and settings. */
export const fetchAll = (
  name: "categories" | "settings",
  signal?: AbortSignal,
) => request<OnlinePage>(`/api/data/${name}`, { signal }).then((r) => r.items);

/** The shop's change counter. The answer also carries the shop's billing, which is kept. */
export async function fetchHead(): Promise<number> {
  const sentAt = Date.now();
  const head = await request<{ syncSeq: number; billing?: BillingStamp }>(
    "/api/sync/head",
  );
  void ingestStamp(head.billing, sentAt, Date.now());
  return head.syncSeq;
}

export interface CommandResult {
  status: "applied" | "duplicate";
  docs: WireChange[];
  /** How far the shop's changes got with this save (see ./head.ts). */
  head?: number;
}

export const postCommand = (body: {
  operationId: string;
  type: string;
  input: unknown;
  baseVersion?: number;
}) =>
  request<CommandResult>("/api/commands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Unlock with a PIN on the server (online mode needs the server to know who is working). */
export const postUnlock = (userId: string, pin: string) =>
  request<{ userId: string }>("/api/actor/unlock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, pin }),
  });

export const postLock = () =>
  request<{ ok: true }>("/api/actor/lock", { method: "POST" });

/** The shop's billing page (works while the shop is locked). */
export async function fetchBilling(): Promise<BillingView> {
  const sentAt = Date.now();
  const view = await request<BillingView>("/api/billing");
  void ingestStamp(view.billing, sentAt, Date.now());
  return view;
}

export const postPayment = (body: {
  method: "bkash" | "nagad";
  trxId: string;
  sender: string;
  amount: number;
  planId: string;
}) =>
  request<{ payment: PaymentView; opened: boolean }>("/api/billing/payments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
