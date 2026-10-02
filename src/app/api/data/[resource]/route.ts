import { NextResponse } from "next/server";
import { can } from "@/auth/permissions";
import { requireActor } from "@/server/actor-request";
import { toWire } from "@/server/commands/master-data";
import {
  isResource,
  pageFrom,
  paramsFromSearch,
  permissionFor,
  unknownResource,
  viewerFor,
} from "@/server/data/http";
import { BadCursorError, listResource } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse, HttpError } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * One page of a list, searched, filtered and sorted on the server (online mode).
 * Categories and settings are small: they come back whole.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const { resource } = await params;
    const search = new URL(request.url).searchParams;

    if (resource === "categories" || resource === "settings") {
      const actor = await requireActor(request);
      const { db } = await getSyncDeps();
      const rows = await db
        .collection(resource)
        .find({ storeId: actor.storeId, deletedAt: null })
        .limit(2000)
        .toArray();
      return NextResponse.json({
        items: rows.map((d) => toWire(d as never)),
        nextCursor: null,
      });
    }
    if (!isResource(resource)) return unknownResource();

    const actor = await requireActor(request, permissionFor(resource));
    const parsed = paramsFromSearch(resource, search);
    // The supplier side of payments is for people who manage purchases.
    if (
      resource === "payments" &&
      !can(actor.role, "purchase.manage") &&
      (parsed as { type: string }).type !== "customer"
    )
      (parsed as { type: string }).type = "customer";

    const { db } = await getSyncDeps();
    return NextResponse.json(
      await listResource(
        db,
        resource,
        parsed,
        await viewerFor(actor),
        pageFrom(search),
      ),
    );
  } catch (error) {
    if (error instanceof BadCursorError)
      return errorResponse(new HttpError(400, "BAD_CURSOR"));
    return errorResponse(error);
  }
}
