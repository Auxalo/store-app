import "server-only";
import { can, type Permission } from "@/auth/permissions";
import {
  type ListParams,
  parseListParams,
  RESOURCES,
  type Resource,
} from "@/data/spec";
import type { RequestActor } from "../actor-request";
import { getSyncDeps } from "../deps";
import { HttpError } from "../http";
import { storeTimeZone, type Viewer } from "./service";

/** What a person needs to open each list; the rest are open to everyone signed in (as in the menu). */
const PERMISSION: Partial<Record<Resource, Permission>> = {
  suppliers: "purchase.manage",
  purchases: "purchase.manage",
  expenses: "expense.manage",
  returns: "sale.void",
};

export function isResource(name: string): name is Resource {
  return (RESOURCES as readonly string[]).includes(name);
}

export function permissionFor(resource: Resource): Permission | undefined {
  return PERMISSION[resource];
}

/** The URL query string as list params; anything unknown or malformed is a 400. */
export function paramsFromSearch<R extends Resource>(
  resource: R,
  search: URLSearchParams,
): ListParams<R> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of search) {
    if (key === "limit" || key === "cursor") continue;
    input[key] = key === "dueOnly" ? value === "true" || value === "1" : value;
  }
  return parseListParams(resource, input);
}

export async function viewerFor(actor: RequestActor): Promise<Viewer> {
  const { db } = await getSyncDeps();
  return {
    storeId: actor.storeId,
    canSeeCost: can(actor.role, "purchasePrice.view"),
    timeZone: await storeTimeZone(db, actor.storeId),
  };
}

export function pageFrom(search: URLSearchParams) {
  const limit = Number(search.get("limit") ?? "");
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    cursor: search.get("cursor"),
  };
}

export function unknownResource(): never {
  throw new HttpError(404, "UNKNOWN_RESOURCE");
}
