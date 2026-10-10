import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";
import { APP_VERSION } from "@/lib/app-version";
import { telemetryEnabled } from "@/server/telemetry";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

/**
 * "Is the server set up right?" for the person who deployed it: which settings are present (never
 * their values) and whether the database answers. Open /api/health after a deploy.
 */
export async function GET(request: Request) {
  // The app's own "is the server reachable?" check (every few seconds while offline) only needs an
  // answer from this function, not a trip to the database.
  if (new URL(request.url).searchParams.has("probe"))
    return NextResponse.json({ ok: true });
  const settings = {
    MONGODB_URI: !!process.env.MONGODB_URI,
    BETTER_AUTH_SECRET: (process.env.BETTER_AUTH_SECRET ?? "").length >= 32,
    BETTER_AUTH_URL: !!process.env.BETTER_AUTH_URL,
  };
  let database: string;
  let pingMs: number | undefined;
  try {
    const db = await getDb();
    const start = Date.now();
    await db.command({ ping: 1 });
    pingMs = Date.now() - start;
    database = "ok";
  } catch (error) {
    // The kind of problem only (for example a blocked address), not the connection string.
    database = error instanceof Error ? error.name : "error";
  }
  const ok = database === "ok" && Object.values(settings).every(Boolean);
  return NextResponse.json(
    {
      ok,
      version: APP_VERSION,
      settings,
      database,
      // How long one round trip to the database takes from this server (a high number means the
      // server and the database are far apart).
      databasePingMs: pingMs,
      errorReporting: telemetryEnabled(),
    },
    { status: ok ? 200 : 503 },
  );
}
