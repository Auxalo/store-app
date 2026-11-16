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
 * A typed number as plain text: ASCII digits, no thousands separators, "." before the decimals.
 * A comma is the decimal mark when it is written the continental way: one comma with one or two
 * digits after it ("40,50", "1,5") or a comma after the dots ("1.250,50"). Any other comma is a
 * thousands separator ("1,250", "1,25,000.50").
 */
export function plainDecimal(input: string): string {
  const s = bnToEn(input).replace(/[\s٬]/g, "").replace("٫", ".").trim();
  const comma = s.lastIndexOf(",");
  if (comma === -1) return s;
  const after = s.length - comma - 1;
  const decimal =
    s.indexOf(",") === comma &&
    (s.includes(".") ? comma > s.lastIndexOf(".") : after === 1 || after === 2);
  return decimal
    ? `${s.slice(0, comma).replace(/\./g, "")}.${s.slice(comma + 1)}`
    : s.replace(/,/g, "");
}

/**
 * Parses a user-typed decimal number. Accepts Bangla or ASCII digits, thousands
 * separators (",", spaces), a decimal comma ("40,50") and the Arabic decimal separator.
 * Returns NaN when the input is not a plain number so callers can reject it explicitly.
 */
export function parseDecimal(input: string): number {
  const cleaned = plainDecimal(input);
  if (cleaned === "" || !/^-?\d*\.?\d*$/.test(cleaned) || cleaned === "-") {
    return Number.NaN;
  }
  return Number(cleaned);
}
