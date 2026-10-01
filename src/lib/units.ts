/**
 * Selling units. `decimals` is how many decimal places a quantity may have (pieces: none,
 * kilograms: three). Quantities are stored in milli-units, so this only limits what can be typed.
 */
export const UNITS = [
  { code: "pcs", decimals: 0 },
  { code: "dozen", decimals: 0 },
  { code: "packet", decimals: 0 },
  { code: "box", decimals: 0 },
  { code: "bottle", decimals: 0 },
  { code: "kg", decimals: 3 },
  { code: "g", decimals: 0 },
  { code: "litre", decimals: 3 },
  { code: "ml", decimals: 0 },
  { code: "meter", decimals: 2 },
] as const;

export type UnitCode = (typeof UNITS)[number]["code"];

export const UNIT_CODES = UNITS.map((u) => u.code) as [UnitCode, ...UnitCode[]];

export function unitDecimals(code: string): 0 | 1 | 2 | 3 {
  return (UNITS.find((u) => u.code === code)?.decimals ?? 0) as 0 | 1 | 2 | 3;
}
