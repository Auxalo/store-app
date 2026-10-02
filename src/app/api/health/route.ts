import { NextResponse } from "next/server";
import { getDb } from "@/db/server/mongo";

export const dynamic = "force-dynamic";

/**
 * "Is the server set up right?" for the person who deployed it: which settings are present (never
 * their values) and whether the database answers. Open /api/health after a deploy.
 */
export async function GET() {
  const settings = {
    MONGODB_URI: !!process.env.MONGODB_URI,
    BETTER_AUTH_SECRET: (process.env.BETTER_AUTH_SECRET ?? "").length >= 32,
    BETTER_AUTH_URL: !!process.env.BETTER_AUTH_URL,
  };
  let database: string;
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    database = "ok";
  } catch (error) {
    // The kind of problem only (for example a blocked address), not the connection string.
    database = error instanceof Error ? error.name : "error";
  }
  const ok = database === "ok" && Object.values(settings).every(Boolean);
  return NextResponse.json(
    { ok, settings, database },
    { status: ok ? 200 : 503 },
  );
}
