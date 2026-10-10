import { NextResponse } from "next/server";
import { deviceSigningKey } from "@/auth/op-proof";
import { serverEnv } from "@/lib/env";
import { requireActor } from "@/server/actor-request";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

/**
 * The signing key of the person working on this device (see deviceSigningKey). Only the person the
 * server already knows is working here gets it: someone who has just typed their password or whose
 * PIN the server checked (the signed actor cookie). Every tab of the browser can ask, so a sale
 * made in any tab is signed. Locking the counter forgets the person, and with it this answer.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, undefined, { allowLocked: true });
    return NextResponse.json({
      userId: actor.id,
      key: deviceSigningKey(
        serverEnv().BETTER_AUTH_SECRET,
        actor.id,
        actor.deviceId,
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
