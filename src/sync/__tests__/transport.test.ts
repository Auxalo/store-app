import { describe, expect, it } from "vitest";
import { createFetchTransport, type TransportError } from "../transport";

const answer = (status: number, body: unknown = {}) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

const failure = (fetchImpl: typeof fetch) =>
  createFetchTransport(fetchImpl)
    .pull(0)
    .then(
      () => null,
      (e: unknown) => e as TransportError,
    );

describe("how the device understands the server's answers", () => {
  it("passes a good answer through", async () => {
    const page = { serverTime: "x", cursor: 4, hasMore: false, changes: {} };
    const transport = createFetchTransport(answer(200, page));
    expect(await transport.pull(0)).toEqual(page);
  });

  it("no connection is a network problem, which is retried", async () => {
    const error = await failure((async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    expect(error?.kind).toBe("network");
  });

  it("a paused shop is told apart from a sign-in problem", async () => {
    const error = await failure(answer(403, { code: "SHOP_SUSPENDED" }));
    expect(error).toMatchObject({ kind: "suspended", status: 403 });
  });

  it("an unknown or refused device is a sign-in problem", async () => {
    expect((await failure(answer(401, { code: "DEVICE_MISSING" })))?.kind).toBe(
      "auth",
    );
    expect((await failure(answer(403, { code: "DEVICE_REVOKED" })))?.kind).toBe(
      "auth",
    );
  });

  it("an app that is too old is told to update, and the queue is kept", async () => {
    expect(
      (await failure(answer(426, { code: "UPGRADE_REQUIRED" })))?.kind,
    ).toBe("upgrade");
  });

  it("server errors, busy answers and too-large requests are server problems", async () => {
    for (const status of [429, 500, 502, 503, 413])
      expect((await failure(answer(status)))?.kind, String(status)).toBe(
        "server",
      );
  });

  it("an answer that is not JSON still gives the right kind", async () => {
    const html = (async () =>
      new Response("<html>bad gateway</html>", {
        status: 502,
      })) as unknown as typeof fetch;
    expect((await failure(html))?.kind).toBe("server");
  });

  it("sends a push as JSON to the push address, and a pull with its position", async () => {
    const seen: Array<{ url: string; method?: string; body?: unknown }> = [];
    const spy = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method, body: init?.body });
      return new Response(JSON.stringify({ results: [], serverTime: "x" }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const transport = createFetchTransport(spy);
    await transport.push({
      deviceId: "d",
      appVersion: "1.0.0",
      ops: [],
    });
    await transport.pull(42, 100);
    expect(seen[0]).toMatchObject({ url: "/api/sync/push", method: "POST" });
    expect(JSON.parse(String(seen[0].body)).deviceId).toBe("d");
    expect(seen[1].url).toBe("/api/sync/pull?cursor=42&limit=100");
  });
});
