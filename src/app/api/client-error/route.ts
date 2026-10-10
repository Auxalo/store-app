import { NextResponse } from "next/server";
import { z } from "zod";
import { parseDeviceCookie } from "@/server/devices";
import { checkRateLimit } from "@/server/rate-limit";
import { noteRequest } from "@/server/request-context";
import { reportError, scrubText } from "@/server/telemetry";

export const dynamic = "force-dynamic";
// A small request: stop it early rather than let it hold a function instance.
export const maxDuration = 10;

const bodySchema = z.object({
  kind: z.enum(["error", "rejection", "boundary"]),
  message: z.string().max(500),
  stack: z.string().max(3000).optional(),
  url: z.string().max(200).optional(),
});

/**
 * A crash in someone's browser, passed on to the error service. The page does not carry the (large)
 * Sentry browser library: it sends this small note here and the server reports it, so the page stays
 * light and the security policy can stay "only talk to ourselves". What arrives is cut down and
 * scrubbed (long numbers and addresses removed), and a device may send only so many.
 */
export async function POST(request: Request) {
  try {
    const device = parseDeviceCookie(request.headers.get("cookie"));
    noteRequest(request, { deviceId: device?.deviceId });
    checkRateLimit(`client-error:${device?.deviceId ?? "anonymous"}`, "write");

    const text = await request.text();
    if (text.length > 8_000) return new NextResponse(null, { status: 413 });
    const body = bodySchema.parse(JSON.parse(text));

    const error = new Error(scrubText(body.message));
    error.name = `Browser${body.kind[0].toUpperCase()}${body.kind.slice(1)}`;
    error.stack = scrubText(body.stack ?? "");
    reportError(error, {
      source: "browser",
      route: body.url,
      fingerprint: `${body.kind}:${scrubText(body.message).slice(0, 120)}`,
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    // A report that cannot be read or is too frequent is simply dropped; it must never cause errors.
    return new NextResponse(null, { status: 204 });
  }
}
