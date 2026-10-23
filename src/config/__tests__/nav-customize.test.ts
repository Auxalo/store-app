import { describe, expect, it } from "vitest";
import { navItemsFor } from "../nav";

describe("the Customize menu entry", () => {
  const has = (role: "owner" | "manager" | "cashier") =>
    navItemsFor(role).some((item) => item.key === "customize");

  it("is for the owner and the manager, not the cashier", () => {
    expect(has("owner")).toBe(true);
    expect(has("manager")).toBe(true);
    expect(has("cashier")).toBe(false);
  });
});
