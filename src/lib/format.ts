import { DEFAULT_TIME_ZONE } from "./constants";
import type { Poisha } from "./money";

export type Locale = "en" | "bn";
export type NumeralSystem = "auto" | "latn" | "beng";

export interface FormatOptions {
  locale: Locale;
  /** "auto" follows the language: Bangla digits for Bangla, ASCII for English. */
  numerals?: NumeralSystem;
  timeZone?: string;
}

// English uses en-IN so amounts get lakh/crore grouping (1,25,000), which is how
// shops in Bangladesh write them. en-BD would give 125,000.
const INTL_LOCALE: Record<Locale, string> = { en: "en-IN", bn: "bn-BD" };

export const TAKA = "৳";

export function createFormat({
  locale,
  numerals = "auto",
  timeZone = DEFAULT_TIME_ZONE,
}: FormatOptions) {
  const nu =
    numerals === "auto" ? (locale === "bn" ? "beng" : "latn") : numerals;
  const tag = `${INTL_LOCALE[locale]}-u-nu-${nu}`;

  const integer = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const fixed2 = new Intl.NumberFormat(tag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const decimal = new Intl.NumberFormat(tag, { maximumFractionDigits: 3 });
  const percent = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
  const dateFmt = new Intl.DateTimeFormat(tag, {
    dateStyle: "medium",
    timeZone,
  });
  const timeFmt = new Intl.DateTimeFormat(tag, {
    timeStyle: "short",
    timeZone,
  });
  const dateTimeFmt = new Intl.DateTimeFormat(tag, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  });

  return {
    locale,
    tag,
    /** Plain number, e.g. 1,25,000 / ১,২৫,০০০ */
    number: (n: number) => decimal.format(n),
    integer: (n: number) => integer.format(n),
    percent: (n: number) => `${percent.format(n)}%`,
    /**
     * Poisha → "৳1,250" or "৳1,250.50". The symbol always leads (Intl puts it after the
     * number in bn-BD). `fraction: "always"` forces two decimals, e.g. for receipts.
     */
    money: (amount: Poisha, fraction: "auto" | "always" = "auto") => {
      const negative = amount < 0;
      const abs = Math.abs(amount);
      const whole = abs % 100 === 0;
      const body =
        fraction === "auto" && whole
          ? integer.format(abs / 100)
          : fixed2.format(abs / 100);
      return `${negative ? "-" : ""}${TAKA}${body}`;
    },
    /** Milli-unit quantity → "1.5" (no trailing zeros). */
    qty: (milli: number) => decimal.format(milli / 1000),
    date: (d: Date | number | string) => dateFmt.format(new Date(d)),
    time: (d: Date | number | string) => timeFmt.format(new Date(d)),
    dateTime: (d: Date | number | string) => dateTimeFmt.format(new Date(d)),
  };
}

export type Formatter = ReturnType<typeof createFormat>;
