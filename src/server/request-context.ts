import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * What the logs and error reports should know about the request being handled, without passing it
 * through every function: an id to find it by, the route, and (once known) which shop and device.
 * Never anything a person typed or a customer's details.
 */
export interface RequestContext {
  requestId: string;
  route: string;
  method: string;
  storeId?: string;
  deviceId?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Starts (or adds to) the context of this request. Safe to call from several places. */
export function noteRequest(
  request: Request,
  known: { storeId?: string; deviceId?: string } = {},
): RequestContext {
  let context = storage.getStore();
  if (!context) {
    let route = "";
    try {
      route = new URL(request.url).pathname;
    } catch {
      /* not a full URL: leave it empty */
    }
    context = {
      requestId:
        request.headers.get("x-vercel-id") ??
        request.headers.get("x-request-id") ??
        randomUUID(),
      route,
      method: request.method,
      startedAt: Date.now(),
    };
    storage.enterWith(context);
  }
  if (known.storeId) context.storeId = known.storeId;
  if (known.deviceId) context.deviceId = known.deviceId;
  return context;
}

export const currentRequest = (): RequestContext | undefined =>
  storage.getStore();
