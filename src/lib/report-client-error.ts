/**
 * Tells the server about a crash in this browser (see /api/client-error). Only in production, and
 * only a few distinct ones per page load, so a crash loop cannot flood anything. Never throws.
 */
const sent = new Set<string>();
const MAX_PER_PAGE_LOAD = 5;

export function reportClientError(
  error: unknown,
  kind: "error" | "rejection" | "boundary",
): void {
  if (process.env.NODE_ENV !== "production") return;
  try {
    const e = error instanceof Error ? error : new Error(String(error));
    const key = `${kind}:${e.message}`.slice(0, 200);
    if (sent.has(key) || sent.size >= MAX_PER_PAGE_LOAD) return;
    sent.add(key);
    const body = JSON.stringify({
      kind,
      message: e.message.slice(0, 500),
      stack: (e.stack ?? "").slice(0, 3000),
      url: location.pathname,
    });
    if (typeof navigator.sendBeacon === "function")
      navigator.sendBeacon(
        "/api/client-error",
        new Blob([body], { type: "application/json" }),
      );
    else
      void fetch("/api/client-error", {
        method: "POST",
        body,
        keepalive: true,
        headers: { "content-type": "application/json" },
      }).catch(() => undefined);
  } catch {
    /* reporting must never cause a problem of its own */
  }
}

/** Listens for crashes the page does not catch itself. Returns a function that stops listening. */
export function installErrorReporting(): () => void {
  const onError = (event: ErrorEvent) =>
    reportClientError(event.error ?? event.message, "error");
  const onRejection = (event: PromiseRejectionEvent) =>
    reportClientError(event.reason, "rejection");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
