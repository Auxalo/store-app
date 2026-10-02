import { NextResponse } from "next/server";
import { requireActor } from "@/server/actor-request";
import { viewerFor } from "@/server/data/http";
import { lookupProduct } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** A scanned or typed barcode or SKU: the one active product it belongs to (or none). */
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const code = new URL(request.url).searchParams.get("code") ?? "";
    const { db } = await getSyncDeps();
    return NextResponse.json({
      product: await lookupProduct(db, code, await viewerFor(actor)),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
