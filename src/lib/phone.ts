import { bnToEn } from "./numerals";

/**
 * Phone numbers are optional everywhere, but one that is given must look like a phone number.
 * Bangla digits, spaces and dashes are accepted while typing; what is stored is the plain digits
 * (with a leading + if there was one), e.g. "০১৭১১-০০০০০১" → "01711000001".
 */
export function normalizePhone(input: string): string {
  const raw = bnToEn(input).trim();
  const plus = raw.startsWith("+");
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `${plus ? "+" : ""}${digits}` : "";
}

/** Empty is fine; otherwise 6 to 15 digits, optionally starting with +. */
export function isValidPhone(input: string): boolean {
  const raw = bnToEn(input).trim();
  if (raw === "") return true;
  if (/[^\d\s()+-]/.test(raw)) return false;
  const digits = raw.replace(/[^\d]/g, "").length;
  return digits >= 6 && digits <= 15;
}
