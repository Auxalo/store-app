/** Runs once when the server starts, and reports errors Next catches itself. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initTelemetry } = await import("./server/telemetry");
    initTelemetry();
  }
}

export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("./server/telemetry");
  reportError(error, {
    route: context.routePath ?? request.path,
    method: request.method,
  });
}
