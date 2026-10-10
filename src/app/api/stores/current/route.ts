import { NextResponse } from "next/server";
import { getAuth } from "@/auth/server";
import { getDb } from "@/db/server/mongo";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

/** The signed-in user's store (name, currency, time zone). */
export async function GET(request: Request) {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });

  const store = await (await getDb())
    .collection<{
      _id: string;
      name: string;
      currency: string;
      timeZone: string;
    }>("stores")
    .findOne({ _id: (session.user as { storeId: string }).storeId });
  if (!store) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  return NextResponse.json({
    id: store._id,
    name: store.name,
    currency: store.currency,
    timeZone: store.timeZone,
  });
}
