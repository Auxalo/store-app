import { NextResponse } from "next/server";
import { ownerSignupSchema } from "@/schemas/auth";
import { createStoreWithOwner, UsernameTakenError } from "@/server/onboarding";

export const dynamic = "force-dynamic";

/** Public owner onboarding: creates a store and its owner account. */
export async function POST(request: Request) {
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
    console.error("owner signup failed", error);
    return NextResponse.json({ code: "INTERNAL" }, { status: 500 });
  }
}
