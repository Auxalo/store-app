import "server-only";
import * as Sentry from "@sentry/node";
import { APP_VERSION } from "@/lib/app-version";
import { currentRequest } from "./request-context";

/**
 * Error reporting (Sentry). Off unless SENTRY_DSN is set. It reports what broke and where (route,
 * shop id, device id, app version, request id) and never what people typed or what was sold:
 * request bodies, cookies, headers and addresses are removed, and long numbers (phones, amounts)
 * in messages are blanked before anything leaves the server.
 */
let started = false;

const NUMBERS = /\d{5,}/g;
const EMAILS = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/** Takes personal details out of a piece of text. */
export function scrubText(text: string): string {
  return text.replace(EMAILS, "[email]").replace(NUMBERS, "[number]");
}

export function initTelemetry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (started || !dsn) return;
  started = true;
  Sentry.init({
    dsn,
    release: APP_VERSION,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Errors only: no traces, no profiling, nothing about normal requests.
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        event.request.data = undefined;
        event.request.cookies = undefined;
        event.request.headers = undefined;
        event.request.query_string = undefined;
      }
      event.user = undefined;
      for (const value of event.exception?.values ?? [])
        if (value.value) value.value = scrubText(value.value);
      if (event.message) event.message = scrubText(event.message);
      return event;
    },
  });
}

export const telemetryEnabled = () => started;

/** Reports an unexpected error with what is known about the request. */
export function reportError(
  error: unknown,
  extra: {
    route?: string;
    method?: string;
    source?: "server" | "browser";
    fingerprint?: string;
  } = {},
): void {
  if (!started) return;
  const ctx = currentRequest();
  Sentry.withScope((scope) => {
    scope.setTag("source", extra.source ?? "server");
    scope.setTag("route", extra.route ?? ctx?.route ?? "");
    scope.setTag("method", extra.method ?? ctx?.method ?? "");
    if (ctx?.storeId) scope.setTag("storeId", ctx.storeId);
    if (ctx?.deviceId) scope.setTag("deviceId", ctx.deviceId);
    if (ctx?.requestId) scope.setTag("requestId", ctx.requestId);
    if (extra.fingerprint) scope.setFingerprint([extra.fingerprint]);
    Sentry.captureException(error);
  });
}
