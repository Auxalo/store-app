import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * Proof that a queued action was made by the person it names.
 *
 * A device syncs later, so the server cannot see who was at the counter. Without a proof, any
 * device of the shop could send an action in the owner's name. With one, an owner or manager
 * action must carry a signature made with a key only that person's PIN produces (the key is made
 * when the PIN is typed and kept in memory; the check-value other devices hold cannot make it).
 *
 * The signature covers everything that matters, so an action cannot be changed or re-dated after
 * it was signed. It is computed synchronously because it runs inside the database transaction
 * that saves the action.
 */

export interface SignedOp {
  operationId: string;
  type: string;
  schemaVersion: number;
  payload: unknown;
  actorUserId: string;
  deviceId: string;
  createdAt: string;
}

/** JSON with sorted keys, so both sides write the same text for the same data. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const text = (value: string) => new TextEncoder().encode(value);

/**
 * What the signature covers of the payload: all of it except `baseVersion`, which the app itself
 * changes when a person settles an edit conflict ("keep mine") and which only says which version
 * the edit started from.
 */
function signedPayload(payload: unknown): unknown {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const { baseVersion: _baseVersion, ...rest } = payload as Record<
      string,
      unknown
    >;
    return rest;
  }
  return payload;
}

function message(op: SignedOp): Uint8Array {
  return text(
    [
      "op1",
      op.operationId,
      op.type,
      op.schemaVersion,
      op.actorUserId,
      op.deviceId,
      op.createdAt,
      canonicalJson(signedPayload(op.payload)),
    ].join("\n"),
  );
}

/**
 * A signing key for one person on one device, made by the server from its secret (nothing is
 * stored). It is handed only to a device where that person has just proved who they are (their
 * password, or their PIN checked online), so work they queue there can be signed even when they
 * signed in with the password and never typed a PIN, and in every tab of that browser.
 */
export function deviceSigningKey(
  secret: string,
  userId: string,
  deviceId: string,
): string {
  return toBase64(
    hmac(sha256, text(secret), text(`op-device|${userId}|${deviceId}`)),
  );
}

/** Signs an action with a person's key (base64, from `deriveProofKey` or `deviceSigningKey`). */
export function signOp(keyBase64: string, op: SignedOp): string {
  return toBase64(hmac(sha256, fromBase64(keyBase64), message(op)));
}

/** True when `proof` is the signature of `op` under that key (compared in constant time). */
export function verifyOpProof(
  keyBase64: string,
  op: SignedOp,
  proof: string,
): boolean {
  let expected: Uint8Array;
  let actual: Uint8Array;
  try {
    expected = hmac(sha256, fromBase64(keyBase64), message(op));
    actual = fromBase64(proof);
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  return diff === 0;
}
