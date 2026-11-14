/**
 * Barcodes as a row of black and white "modules" (a module is the thinnest bar). Pure: no canvas,
 * no library, so it is the same on every device and easy to test by reading the result back.
 *
 * Which barcode a stored code becomes:
 * - 13 digits with a correct check digit → EAN-13 (what packaged goods carry);
 * - 12 digits with a correct check digit → UPC-A;
 * - 8 digits with a correct check digit → EAN-8;
 * - anything else made of plain letters, digits and signs → Code 128 (any text, so a code with a
 *   wrong check digit still scans back as exactly the digits that were typed).
 */

export type BarcodeKind = "ean13" | "upca" | "ean8" | "code128";

export interface Barcode {
  kind: BarcodeKind;
  /** The code as it is printed under the bars (Bangla digits turned into 0-9). */
  text: string;
  /** "1" is a black module, "0" a white one. Starts and ends with a bar. */
  modules: string;
}

export type BarcodeProblem = "EMPTY" | "UNSUPPORTED" | "TOO_LONG";

/** Longest code that gets a barcode (the product form allows 60 characters). */
export const MAX_BARCODE_LENGTH = 40;

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Bangla digits as 0-9 and no spaces round the code. */
export function normalizeCode(code: string): string {
  return [...code.trim()]
    .map((ch) => {
      const at = BANGLA_DIGITS.indexOf(ch);
      return at >= 0 ? String(at) : ch;
    })
    .join("");
}

// ---- EAN / UPC ----

const L = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const R = L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const G = R.map((p) => [...p].reverse().join(""));

/** Which of the 6 left-hand digits of an EAN-13 use the L or the G set, by its first digit. */
const PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];

const START = "101";
const CENTRE = "01010";

/** The check digit for the digits before it (EAN-8, UPC-A, EAN-13 all weigh 3, 1, 3, 1 ... from the right). */
export function checkDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[digits.length - 1 - i]);
    sum += i % 2 === 0 ? d * 3 : d;
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidCheckDigit(code: string): boolean {
  return (
    /^\d+$/.test(code) &&
    code.length >= 2 &&
    checkDigit(code.slice(0, -1)) === Number(code.at(-1))
  );
}

function ean13Modules(code: string): string {
  const parity = PARITY[Number(code[0])];
  let out = START;
  for (let i = 0; i < 6; i++) {
    const digit = Number(code[1 + i]);
    out += (parity[i] === "L" ? L : G)[digit];
  }
  out += CENTRE;
  for (let i = 0; i < 6; i++) out += R[Number(code[7 + i])];
  return out + START;
}

function ean8Modules(code: string): string {
  let out = START;
  for (let i = 0; i < 4; i++) out += L[Number(code[i])];
  out += CENTRE;
  for (let i = 4; i < 8; i++) out += R[Number(code[i])];
  return out + START;
}

// ---- Code 128 ----

/** Bar and space widths of every symbol, from the specification: value 0..105, then Stop. */
const C128 = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
];
export const C128_PATTERNS = C128;
const C128_STOP = "2331112";
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;

/** The symbol values for a text of plain characters (space to ~), as short as possible. */
export function code128Values(text: string): number[] {
  const n = text.length;
  const isDigit = (i: number) => text[i] >= "0" && text[i] <= "9";
  const pairAt = (i: number) => i + 1 < n && isDigit(i) && isDigit(i + 1);
  // cost[i][m]: fewest symbols to write text[i..] when the current mode is m (0 = B, 1 = C).
  const cost: number[][] = Array.from({ length: n + 1 }, () => [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]);
  cost[n] = [0, 0];
  const step: Array<Array<"b" | "c" | "toC" | "toB">> = Array.from(
    { length: n + 1 },
    () => ["b", "c"],
  );
  for (let i = n - 1; i >= 0; i--) {
    // In C the only way on is a pair of digits; written first because B can change over to it.
    const inC = pairAt(i) ? 1 + cost[i + 2][1] : Number.POSITIVE_INFINITY;
    // In B: write one character, or change to C (when two digits follow).
    cost[i][0] = 1 + cost[i + 1][0];
    step[i][0] = "b";
    if (inC !== Number.POSITIVE_INFINITY && 1 + inC < cost[i][0]) {
      cost[i][0] = 1 + inC;
      step[i][0] = "toC";
    }
    // In C: write a pair of digits, or change to B.
    cost[i][1] = inC;
    step[i][1] = "c";
    if (1 + cost[i][0] < cost[i][1]) {
      cost[i][1] = 1 + cost[i][0];
      step[i][1] = "toB";
    }
  }
  // The shorter start wins (C needs two digits first).
  const startC = pairAt(0) && 1 + cost[0][1] < 1 + cost[0][0];
  const values: number[] = [startC ? START_C : START_B];
  let mode = startC ? 1 : 0;
  let i = 0;
  while (i < n) {
    const s = step[i][mode];
    if (s === "toC") {
      values.push(CODE_C);
      mode = 1;
    } else if (s === "toB") {
      values.push(CODE_B);
      mode = 0;
    } else if (s === "c") {
      values.push(Number(text.slice(i, i + 2)));
      i += 2;
    } else {
      values.push(text.charCodeAt(i) - 32);
      i += 1;
    }
  }
  const sum = values.reduce(
    (acc, v, idx) => acc + v * (idx === 0 ? 1 : idx),
    0,
  );
  values.push(sum % 103);
  return values;
}

function code128Modules(text: string): string {
  const widths = [...code128Values(text).map((v) => C128[v]), C128_STOP].join(
    "",
  );
  let out = "";
  let black = true;
  for (const w of widths) {
    out += (black ? "1" : "0").repeat(Number(w));
    black = !black;
  }
  return out;
}

// ---- which barcode ----

/** The barcode for a stored code, or why there is none. */
export function encodeBarcode(
  stored: string,
): { ok: true; barcode: Barcode } | { ok: false; problem: BarcodeProblem } {
  const text = normalizeCode(stored);
  if (text === "") return { ok: false, problem: "EMPTY" };
  if (text.length > MAX_BARCODE_LENGTH)
    return { ok: false, problem: "TOO_LONG" };
  // Plain letters, digits and signs only (what every scanner can send as keys).
  if (![...text].every((ch) => ch >= " " && ch <= "~"))
    return { ok: false, problem: "UNSUPPORTED" };

  if (/^\d{13}$/.test(text) && hasValidCheckDigit(text))
    return {
      ok: true,
      barcode: { kind: "ean13", text, modules: ean13Modules(text) },
    };
  if (/^\d{12}$/.test(text) && hasValidCheckDigit(text))
    return {
      ok: true,
      // UPC-A is an EAN-13 with a 0 in front.
      barcode: { kind: "upca", text, modules: ean13Modules(`0${text}`) },
    };
  if (/^\d{8}$/.test(text) && hasValidCheckDigit(text))
    return {
      ok: true,
      barcode: { kind: "ean8", text, modules: ean8Modules(text) },
    };
  return {
    ok: true,
    barcode: { kind: "code128", text, modules: code128Modules(text) },
  };
}

/**
 * Empty space needed on each side, in modules. The label's own margin counts toward it, so the
 * label layout only asks for what the margin does not already give.
 */
export const QUIET_MODULES: Record<BarcodeKind, number> = {
  ean13: 11,
  upca: 9,
  ean8: 7,
  code128: 10,
};

// ---- a code of the shop's own ----

/**
 * A new code for a product that has none: an EAN-13 starting with 2, the range meant for codes a
 * shop makes itself (no maker's code can clash with it). 11 random digits and the check digit.
 */
export function makeStoreEan13(random: () => number = secureRandom): string {
  let digits = "2";
  for (let i = 0; i < 11; i++) digits += String(Math.floor(random() * 10));
  return digits + checkDigit(digits);
}

function secureRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}
