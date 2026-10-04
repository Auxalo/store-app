import { bnToEn } from "@/lib/numerals";

/**
 * PINs let people on a shared counter switch users, even offline. They guard against casual
 * access, not a stolen unlocked device: the PIN's hash is stored on the device (salted, and slow
 * to compute on purpose), and the server re-checks every action's permissions regardless.
 */
export const PIN_ITERATIONS = 310_000;
export const PIN_PATTERN = /^\d{4,6}$/;

export interface PinHash {
  /** base64 */
  salt: string;
  /** base64 */
  hash: string;
  /**
   * base64. A second value made from the same PIN that is never sent to other devices: it signs
   * the person's offline work so the server can tell it really came from them (src/auth/op-proof.ts).
   * Only the server (which stores it) and the person who knows the PIN can make it.
   */
  proof?: string;
}

/**
 * An owner's or manager's PIN guards far more than a cashier's, and anyone who holds its check-value
 * can try every PIN against it (about 15 minutes for 4 digits on one computer, over a day for 6).
 * So theirs must be 6 digits.
 */
export const STRONG_PIN_PATTERN = /^\d{6}$/;
export const needsStrongPin = (role: string | undefined) =>
  role === "owner" || role === "manager";

/** Accepts Bangla digits; returns the ASCII PIN or null if it is not 4–6 digits (6 for an owner or manager). */
export function normalizePin(input: string, role?: string): string | null {
  const pin = bnToEn(input.trim());
  return (needsStrongPin(role) ? STRONG_PIN_PATTERN : PIN_PATTERN).test(pin)
    ? pin
    : null;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations: PIN_ITERATIONS,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** The signing key of a PIN: derived like the hash, but from a different salt, so the one cannot be made from the other. */
export async function deriveProofKey(
  pin: string,
  saltBase64: string,
): Promise<string> {
  const salt = fromBase64(saltBase64);
  const tagged = new Uint8Array(salt.length + PROOF_TAG.length);
  tagged.set(salt);
  tagged.set(PROOF_TAG, salt.length);
  return toBase64(await derive(pin, tagged));
}

const PROOF_TAG = new TextEncoder().encode("|proof");

/** Hashes a PIN with a fresh random salt (and makes its signing key). */
export async function hashPin(pin: string): Promise<PinHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltBase64 = toBase64(salt);
  return {
    salt: saltBase64,
    hash: toBase64(await derive(pin, salt)),
    proof: await deriveProofKey(pin, saltBase64),
  };
}

/** Checks a PIN against a stored hash in constant time. */
export async function verifyPin(
  pin: string,
  stored: PinHash,
): Promise<boolean> {
  const expected = fromBase64(stored.hash);
  const actual = await derive(pin, fromBase64(stored.salt));
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  return diff === 0;
}
