const BN_ZERO = 0x09e6; // ০

/** Converts Bangla digits (০-৯) to ASCII digits. Other characters are untouched. */
export function bnToEn(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    out += code >= BN_ZERO && code <= BN_ZERO + 9 ? String(code - BN_ZERO) : ch;
  }
  return out;
}

/**
 * Parses a user-typed decimal number. Accepts Bangla or ASCII digits, thousands
 * separators (",", spaces) and the Arabic decimal separator. Returns NaN when the
 * input is not a plain number so callers can reject it explicitly.
 */
export function parseDecimal(input: string): number {
  const cleaned = bnToEn(input)
    .replace(/[\s,٬]/g, "")
    .replace("٫", ".")
    .trim();
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned) || cleaned === "-") {
    return Number.NaN;
  }
  return Number(cleaned);
}
