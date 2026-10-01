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
}

/** Accepts Bangla digits; returns the ASCII PIN or null if it is not 4–6 digits. */
export function normalizePin(input: string): string | null {
  const pin = bnToEn(input.trim());
  return PIN_PATTERN.test(pin) ? pin : null;
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

/** Hashes a PIN with a fresh random salt. */
export async function hashPin(pin: string): Promise<PinHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toBase64(salt), hash: toBase64(await derive(pin, salt)) };
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
