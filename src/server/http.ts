import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { currentRequest } from "./request-context";
import { reportError } from "./telemetry";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    /** More for the client to act on (for example the shop's billing with BILLING_DUE). */
    public readonly extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { ...error.extra, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ code: "INVALID_INPUT" }, { status: 400 });
  }
  // One line that can be searched in the logs, with no customer details in it, and a report to the
  // error service (if one is set up) carrying the same facts.
  const ctx = currentRequest();
  console.error(
    JSON.stringify({
      level: "error",
      msg: "unhandled route error",
      requestId: ctx?.requestId,
      route: ctx?.route,
      method: ctx?.method,
      storeId: ctx?.storeId,
      deviceId: ctx?.deviceId,
      ms: ctx ? Date.now() - ctx.startedAt : undefined,
      error:
        error instanceof Error
          ? `${error.name}: ${error.message.slice(0, 300)}`
          : String(error).slice(0, 300),
    }),
  );
  reportError(error);
  return NextResponse.json(
    { code: "INTERNAL", requestId: ctx?.requestId },
    { status: 500 },
  );
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
