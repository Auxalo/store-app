import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  type SignedOp,
  signOp,
  verifyOpProof,
} from "../op-proof";
import { deriveProofKey, hashPin } from "../pin";

const op = (over: Partial<SignedOp> = {}): SignedOp => ({
  operationId: "0b6f0c52-7d4e-4a4b-9f0e-5a3c2d1e0f11",
  type: "stock.adjust",
  schemaVersion: 1,
  payload: { productId: "p1", delta: -3000, note: "damaged", baseVersion: 2 },
  actorUserId: "u1",
  deviceId: "d1",
  createdAt: "2026-10-04T09:00:00.000Z",
  ...over,
});

describe("the key a PIN makes", () => {
  it("is made from the PIN, is different from the check-value, and is stable", async () => {
    const pin = await hashPin("482913");
    expect(pin.proof).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(pin.proof).not.toBe(pin.hash);
    expect(await deriveProofKey("482913", pin.salt)).toBe(pin.proof);
    expect(await deriveProofKey("482914", pin.salt)).not.toBe(pin.proof);
  });
});

describe("signing an action", () => {
  it("verifies with the same key and fails with any other", async () => {
    const key = (await hashPin("1111")).proof as string;
    const other = (await hashPin("2222")).proof as string;
    const proof = signOp(key, op());
    expect(verifyOpProof(key, op(), proof)).toBe(true);
    expect(verifyOpProof(other, op(), proof)).toBe(false);
  });

  it("covers every part of the action", async () => {
    const key = (await hashPin("1111")).proof as string;
    const proof = signOp(key, op());
    for (const changed of [
      op({ operationId: "1b6f0c52-7d4e-4a4b-9f0e-5a3c2d1e0f11" }),
      op({ type: "stock.adjust2" }),
      op({ actorUserId: "u2" }),
      op({ deviceId: "d2" }),
      op({ createdAt: "2026-10-04T09:00:01.000Z" }),
      op({ schemaVersion: 2 }),
      op({ payload: { productId: "p1", delta: 3000, note: "damaged" } }),
    ])
      expect(verifyOpProof(key, changed, proof)).toBe(false);
  });

  it("does not depend on the order of the payload's keys, nor on baseVersion", async () => {
    const key = (await hashPin("1111")).proof as string;
    const proof = signOp(key, op());
    const reordered = op({
      payload: {
        note: "damaged",
        baseVersion: 9,
        delta: -3000,
        productId: "p1",
      },
    });
    expect(verifyOpProof(key, reordered, proof)).toBe(true);
  });

  it("survives a trip through JSON, as it does on the wire", async () => {
    const key = (await hashPin("1111")).proof as string;
    const original = op({ payload: { a: [1, { b: "বাংলা" }], c: null } });
    const proof = signOp(key, original);
    const sent = JSON.parse(JSON.stringify(original)) as SignedOp;
    expect(verifyOpProof(key, sent, proof)).toBe(true);
  });

  it("rejects a proof that is not valid base64 or has the wrong length", async () => {
    const key = (await hashPin("1111")).proof as string;
    expect(verifyOpProof(key, op(), "not base64!!")).toBe(false);
    expect(verifyOpProof(key, op(), "AAAA")).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, 1] } })).toBe(
      '{"a":{"c":[2,1]},"b":1}',
    );
  });
});
