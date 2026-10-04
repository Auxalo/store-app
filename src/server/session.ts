import "server-only";
import { ObjectId } from "mongodb";
import { can, isRole, type Permission, type Role } from "@/auth/permissions";
import { getAuth } from "@/auth/server";
import { getMongoClient } from "@/db/server/mongo";
import { serverEnv } from "@/lib/env";
import { HttpError } from "./http";
import { noteRequest } from "./request-context";
import { shopIsSuspended } from "./shop-status";

export interface SessionUser {
  id: string;
  name: string;
  storeId: string;
  role: Role;
}

/**
 * The signed-in user, with role and active flag read fresh from the database rather than from the
 * cookie, so a demotion or deactivation takes effect on the very next admin request.
 */
export async function requireUser(
  request: Request,
  permission?: Permission,
): Promise<SessionUser> {
  noteRequest(request);
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new HttpError(401, "UNAUTHORIZED");

  const db = (await getMongoClient()).db(serverEnv().MONGODB_DB);
  const doc = ObjectId.isValid(session.user.id)
    ? await db
        .collection("user")
        .findOne({ _id: new ObjectId(session.user.id) })
    : null;
  if (!doc || doc.isActive === false || !isRole(doc.role))
    throw new HttpError(403, "USER_INACTIVE");
  // An operator (who runs the service) belongs to no shop: none of a shop's endpoints is theirs.
  if (doc.platformAdmin === true) throw new HttpError(403, "FORBIDDEN");
  if (permission && !can(doc.role, permission))
    throw new HttpError(403, "FORBIDDEN");
  if (await shopIsSuspended(db, doc.storeId as string))
    throw new HttpError(403, "SHOP_SUSPENDED");
  noteRequest(request, { storeId: doc.storeId as string });
  return {
    id: session.user.id,
    name: doc.name as string,
    storeId: doc.storeId as string,
    role: doc.role,
  };
}
