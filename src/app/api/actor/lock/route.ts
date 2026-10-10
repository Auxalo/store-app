import { NextResponse } from "next/server";
import { ACTOR_COOKIE } from "@/server/actor";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

/** Locking the counter forgets who was working: the next online action needs a PIN again. */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACTOR_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
