import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
  }
  console.error("unhandled route error", error);
  return NextResponse.json({ code: "INTERNAL" }, { status: 500 });
}

const MAX_BODY_BYTES = 1_000_000;

/** Reads a JSON body, refusing anything unreasonably large before parsing it. */
export async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES)
    throw new HttpError(413, "PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "INVALID_JSON");
  }
}

/** Compares dotted version strings numerically ("1.10.0" > "1.9.0"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
