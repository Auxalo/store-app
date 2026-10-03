import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/auth/permissions";
import { requireActor } from "@/server/actor-request";
import { headOf, hideCostInChanges } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse, readJson } from "@/server/http";
import { runOnlineCommand } from "@/server/online-commands";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  operationId: z.uuid(),
  type: z.string().min(1).max(60),
  input: z.unknown(),
  baseVersion: z.number().int().min(0).optional(),
});

const STATUS = {
  invalid: 400,
  forbidden: 403,
  rejected: 422,
  conflict: 409,
  retry: 503,
} as const;

/**
 * Something a person did while online (a sale, a new product, an edit). The server works out the
 * document number, costs and versions itself, applies it once (a retry with the same operationId
 * returns the same answer), and returns the records that changed.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request);
    const body = bodySchema.parse(await readJson(request));
    const deps = await getSyncDeps();
    const result = await runOnlineCommand(deps, actor, body);
    // The records come back to the browser: leave out what this person may not see (costs).
    const viewer = { canSeeCost: can(actor.role, "purchasePrice.view") };
    const docs = result.docs
      ? hideCostInChanges(result.docs, viewer)
      : undefined;
    if (result.ok)
      // `head` lets the browser know its own change is not news from another device.
      return NextResponse.json({
        status: result.status,
        docs,
        head: headOf(docs ?? []),
      });
    return NextResponse.json(
      { code: result.code, docs },
      { status: STATUS[result.status] },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
