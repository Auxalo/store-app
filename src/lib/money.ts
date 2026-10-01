import { bnToEn, parseDecimal } from "./numerals";

/** Money is always an integer number of poisha (৳1 = 100 poisha). Never a float. */
export type Poisha = number;

export const POISHA_PER_TAKA = 100;

/**
 * "125.50" / "১২৫.৫০" → 12550. Parsed from the decimal string (not via floats) so
 * values like 1.005 round the way a person expects. Returns null for invalid input.
 */
export function parseMoney(input: string): Poisha | null {
  const n = parseDecimal(input);
  if (!Number.isFinite(n)) return null;
  const match = /^(-?)(\d*)\.?(\d*)$/.exec(bnToEn(input).replace(/[\s,]/g, ""));
  if (!match) return toPoisha(n);
  const [, sign, int = "", frac = ""] = match;
  const padded = `${frac}000`;
  let poisha =
    Number(int || "0") * POISHA_PER_TAKA + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) poisha += 1;
  return sign ? -poisha : poisha;
}

/** Taka (possibly fractional) → poisha, rounded to the nearest poisha. */
export function toPoisha(taka: number): Poisha {
  return Math.round(taka * POISHA_PER_TAKA);
}

export function toTaka(poisha: Poisha): number {
  return poisha / POISHA_PER_TAKA;
}

/** Integer division rounding half away from zero. */
export function divRound(numerator: number, denominator: number): number {
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d)) || 0;
}

/** `percentBps` is a percentage in basis points: 10% = 1000, 7.5% = 750. */
export function percentOf(amount: Poisha, percentBps: number): Poisha {
  return divRound(amount * percentBps, 10_000);
}
