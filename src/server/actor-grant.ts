import "server-only";
import type { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { ACTOR_COOKIE, ACTOR_TTL_MS, signActor } from "./actor";

/**
 * How recently a person must have typed their password for it to stand in for a PIN. A session older
 * than this proves nothing about who is at the counter now (on a shared counter the owner's session
 * stays alive while cashiers work), so only a sign-in that has just happened counts.
 */
export const FRESH_SESSION_MS = 5 * 60_000;

export function isFreshSession(
  createdAt: Date | string | number | undefined,
  now = Date.now(),
): boolean {
  if (createdAt === undefined) return false;
  const made = new Date(createdAt).getTime();
  return (
    Number.isFinite(made) && now - made >= 0 && now - made <= FRESH_SESSION_MS
  );
}

/**
 * Typing the account password is proof of who the person is, as good as their PIN: it makes them
 * the working person on this device. This matters most for an owner who has no PIN of their own in
 * a shop where others have one: they could otherwise never be "the person working" again.
 */
export function setPasswordActor(
  response: NextResponse,
  request: Request,
  who: { userId: string; deviceId: string },
  now = Date.now(),
): void {
  response.cookies.set(
    ACTOR_COOKIE,
    signActor(
      {
        userId: who.userId,
        deviceId: who.deviceId,
        expiresAt: now + ACTOR_TTL_MS,
      },
      serverEnv().BETTER_AUTH_SECRET,
    ),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: Math.floor(ACTOR_TTL_MS / 1000),
    },
  );
}
