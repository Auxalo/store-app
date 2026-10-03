import { describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/client-error/route";
import { scrubText } from "../telemetry";

vi.mock("server-only", () => ({}));

const post = (body: string) =>
  POST(
    new Request("http://localhost/api/client-error", { method: "POST", body }),
  );

describe("scrubText", () => {
  it("blanks long numbers (phones, amounts) and email addresses", () => {
    expect(
      scrubText("call 01711000000 or mail a.b@shop.com about 1234567"),
    ).toBe("call [number] or mail [email] about [number]");
    expect(scrubText("item 42 failed")).toBe("item 42 failed");
  });
});

describe("a crash reported by a browser", () => {
  it("is accepted quietly", async () => {
    const response = await post(
      JSON.stringify({ kind: "error", message: "x is undefined", url: "/pos" }),
    );
    expect(response.status).toBe(204);
  });

  it("never causes an error of its own: bad, odd or empty reports are dropped", async () => {
    for (const body of [
      "",
      "not json",
      "{}",
      JSON.stringify({ kind: "nope", message: "x" }),
    ])
      expect((await post(body)).status).toBe(204);
  });

  it("a note that is far too big is refused", async () => {
    const huge = JSON.stringify({
      kind: "error",
      message: "x",
      stack: "y".repeat(20_000),
    });
    expect((await post(huge)).status).toBe(413);
  });
});
