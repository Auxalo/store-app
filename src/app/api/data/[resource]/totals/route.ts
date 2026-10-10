import { NextResponse } from "next/server";
import { requireActor } from "@/server/actor-request";
import {
  isResource,
  paramsFromSearch,
  permissionFor,
  unknownResource,
  viewerFor,
} from "@/server/data/http";
import { totalsOf } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

/** Counts and sums over everything a list matches (its header), not just the page on screen. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const { resource } = await params;
    if (!isResource(resource)) return unknownResource();
    const actor = await requireActor(request, permissionFor(resource));
    const parsed = paramsFromSearch(
      resource,
      new URL(request.url).searchParams,
    );
    const { db } = await getSyncDeps();
    return NextResponse.json({
      totals: await totalsOf(db, resource, parsed, await viewerFor(actor)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
