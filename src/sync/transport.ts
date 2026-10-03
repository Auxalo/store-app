import type { PullResponse, PushRequest, PushResponse } from "@/schemas/sync";

export type TransportErrorKind =
  /** Could not reach the server (offline, DNS, timeout). */
  | "network"
  /** The device is not (or no longer) trusted: sign in again / re-register. */
  | "auth"
  /** The server no longer accepts this app version. Keep the queue and ask to update. */
  | "upgrade"
  /** The operator has paused this shop (403 SHOP_SUSPENDED). Nothing is lost; it resumes when they resume it. */
  | "suspended"
  /** The server answered with an error. Retry later. */
  | "server";

export class TransportError extends Error {
  constructor(
    public readonly kind: TransportErrorKind,
    message: string = kind,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

/** How the engine talks to the server. Tests replace this with an in-process fake. */
export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(cursor: number, limit?: number): Promise<PullResponse>;
}

async function request<T>(
  fetchImpl: typeof fetch,
  input: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(input, { credentials: "same-origin", ...init });
  } catch {
    throw new TransportError("network");
  }
  if (response.ok) return (await response.json()) as T;

  const code = await response
    .json()
    .then((body: { code?: string }) => body.code)
    .catch(() => undefined);
  if (code === "SHOP_SUSPENDED")
    throw new TransportError("suspended", code, response.status);
  if (response.status === 401 || response.status === 403)
    throw new TransportError("auth", code, response.status);
  if (response.status === 426)
    throw new TransportError("upgrade", code, response.status);
  throw new TransportError("server", code, response.status);
}

export function createFetchTransport(
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): SyncTransport {
  return {
    push: (body) =>
      request<PushResponse>(fetchImpl, "/api/sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    pull: (cursor, limit) =>
      request<PullResponse>(
        fetchImpl,
        `/api/sync/pull?cursor=${cursor}${limit ? `&limit=${limit}` : ""}`,
      ),
  };
}
