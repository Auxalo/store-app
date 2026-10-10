import { NextResponse } from "next/server";
import { requireActor } from "@/server/actor-request";
import {
  isResource,
  permissionFor,
  unknownResource,
  viewerFor,
} from "@/server/data/http";
import { getRecord } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse, HttpError } from "@/server/http";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

/** One record with what its own screen needs: a sale with its lines and returns, a person with their statement. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource: string; id: string }> },
) {
  try {
    const { resource, id } = await params;
    if (!isResource(resource)) return unknownResource();
    const actor = await requireActor(request, permissionFor(resource));
    const { db } = await getSyncDeps();
    const found = await getRecord(db, resource, id, await viewerFor(actor));
    if (!found) throw new HttpError(404, "NOT_FOUND");
    return NextResponse.json(found);
  } catch (error) {
    return errorResponse(error);
  }
}
