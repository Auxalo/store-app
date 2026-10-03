import "server-only";
import { ObjectId } from "mongodb";
import { getAuth } from "@/auth/server";
import { getDb } from "@/db/server/mongo";
import { HttpError } from "./http";
import { checkRateLimit } from "./rate-limit";
import { noteRequest } from "./request-context";

export { PLATFORM_STORE_ID } from "@/lib/constants";

export interface PlatformAdmin {
  id: string;
  name: string;
  username: string;
}

/**
 * The operator (the person who runs the service), for the /api/admin routes.
 *
 * An operator is a sign-in account that belongs to no shop and carries `platformAdmin: true`. The
 * flag is read from the database on every request (never from the cookie), and nothing in the app
 * can set it: it is created only by `pnpm admin:create`. An operator has no shop, so none of the
 * shop endpoints (which need a shop's device) work for them, and a shop's people can never reach
 * these routes.
 */
export async function requirePlatformAdmin(
  request: Request,
): Promise<PlatformAdmin> {
  noteRequest(request);
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "UNAUTHORIZED");

  const db = await getDb();
  const doc = ObjectId.isValid(session.user.id)
    ? await db
        .collection("user")
        .findOne({ _id: new ObjectId(session.user.id) })
    : null;
  if (doc?.platformAdmin !== true || doc.isActive === false)
    throw new HttpError(403, "FORBIDDEN");

  checkRateLimit(
    `admin:${session.user.id}`,
    request.method === "GET" ? "read" : "write",
  );
  return {
    id: session.user.id,
    name: String(doc.name ?? ""),
    username: String(doc.username ?? ""),
  };
}
