import { NextResponse } from "next/server";
import { SIGNUP_OPEN } from "@/config/signup";
import { ownerSignupSchema } from "@/schemas/auth";
import { errorResponse, HttpError } from "@/server/http";
import {
  createStoreWithOwner,
  EmailTakenError,
  UsernameTakenError,
} from "@/server/onboarding";
import { checkBudget } from "@/server/rate-limit";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

/** Public owner onboarding: creates a store and its owner account. */
export async function POST(request: Request) {
  // Shop creation is closed for now (see src/config/signup.ts).
  if (!SIGNUP_OPEN)
    return NextResponse.json({ code: "SIGNUP_CLOSED" }, { status: 403 });
  // A handful of new shops an hour from one address is plenty; more is somebody scripting it.
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "?";
    checkBudget(`signup:${ip}`, 5, 60 * 60 * 1000);
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    throw error;
  }
  const body = await request.json().catch(() => null);
  const parsed = ownerSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "INVALID_INPUT", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const result = await createStoreWithOwner(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof UsernameTakenError) {
      return NextResponse.json({ code: "USERNAME_TAKEN" }, { status: 409 });
    }
    if (error instanceof EmailTakenError) {
      return NextResponse.json({ code: "EMAIL_TAKEN" }, { status: 409 });
    }
    console.error("owner signup failed", error);
    return NextResponse.json({ code: "INTERNAL" }, { status: 500 });
  }
}
