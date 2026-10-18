import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { emailSchema } from "@/schemas/auth";
import { getSyncDeps } from "@/server/deps";
import { errorResponse, HttpError, readJson } from "@/server/http";
import { SYNTHETIC_EMAIL_SUFFIX } from "@/server/mail";
import { requireUser } from "@/server/session";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

const bodySchema = z.object({ email: emailSchema });

async function ownerDoc(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "owner") throw new HttpError(403, "FORBIDDEN");
  const { db } = await getSyncDeps();
  if (!ObjectId.isValid(user.id)) throw new HttpError(404, "NOT_FOUND");
  return { db, _id: new ObjectId(user.id) };
}

/** The owner's email for "forgot password" (null while they have none: older accounts do not). */
export async function GET(request: Request) {
  try {
    const { db, _id } = await ownerDoc(request);
    const doc = await db
      .collection("user")
      .findOne({ _id }, { projection: { email: 1 } });
    const email = typeof doc?.email === "string" ? doc.email : "";
    return NextResponse.json({
      email: email && !email.endsWith(SYNTHETIC_EMAIL_SUFFIX) ? email : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** The owner sets or changes it, so a forgotten password can be recovered by mail. */
export async function PATCH(request: Request) {
  try {
    const { db, _id } = await ownerDoc(request);
    const { email } = bodySchema.parse(await readJson(request));
    try {
      await db
        .collection("user")
        .updateOne({ _id }, { $set: { email, updatedAt: new Date() } });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000)
        throw new HttpError(409, "EMAIL_TAKEN");
      throw error;
    }
    return NextResponse.json({ email });
  } catch (error) {
    return errorResponse(error);
  }
}
