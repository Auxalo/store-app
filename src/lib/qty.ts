import { divRound } from "./money";
import { parseDecimal } from "./numerals";

/**
 * Quantities are integers in milli-units: 1.5 kg = 1500, 3 pcs = 3000.
 * This keeps all stock and line-total arithmetic exact.
 */
export type Milli = number;

export const MILLI = 1000;

export function toMilli(qty: number): Milli {
  return Math.round(qty * MILLI);
}

export function fromMilli(milli: Milli): number {
  return milli / MILLI;
}

/** User input ("1.5", "১.৫") → milli-units, or null when invalid / negative. */
export function parseQty(input: string): Milli | null {
  const n = parseDecimal(input);
  if (!Number.isFinite(n) || n < 0) return null;
  return toMilli(n);
}

/** Line total in poisha: unit price (poisha per 1 unit) × quantity (milli-units). */
export function lineTotal(unitPrice: number, qty: Milli): number {
  return divRound(unitPrice * qty, MILLI);
}

/** Rounds a milli quantity to the unit's allowed decimals (pcs: 0, kg: 3). */
export function roundToUnit(qty: Milli, decimals: 0 | 1 | 2 | 3): Milli {
  const step = 10 ** (3 - decimals);
  return divRound(qty, step) * step;
}
