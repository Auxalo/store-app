/**
 * The currencies a shop can show its money in. Only the sign and the name change: amounts are never
 * converted (changing from taka to euro makes ৳100 read €100). Every one has 100 minor units, so the
 * stored whole-number amounts work for all of them.
 */
export const CURRENCIES = [
  {
    code: "BDT",
    symbol: "৳",
    nameEn: "Taka",
    nameBn: "টাকা",
    /** Lakh/crore grouping (1,25,000), as written in Bangladesh and India. */
    lakh: true,
    /** Round-number notes a customer hands over, in minor units (for the quick-cash buttons). */
    notes: [5_000, 10_000, 50_000, 100_000],
  },
  {
    code: "USD",
    symbol: "$",
    nameEn: "US Dollar",
    nameBn: "ডলার",
    lakh: false,
    notes: [500, 1_000, 2_000, 5_000, 10_000],
  },
  {
    code: "EUR",
    symbol: "€",
    nameEn: "Euro",
    nameBn: "ইউরো",
    lakh: false,
    notes: [500, 1_000, 2_000, 5_000, 10_000],
  },
  {
    code: "INR",
    symbol: "₹",
    nameEn: "Indian Rupee",
    nameBn: "রুপি",
    lakh: true,
    notes: [5_000, 10_000, 50_000, 200_000],
  },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]["code"];

export const DEFAULT_CURRENCY_CODE: CurrencyCode = "BDT";

/** The shop's currency is one synced shop setting. */
export const CURRENCY_SETTING_KEY = "store.currency";

export const isCurrencyCode = (value: unknown): value is CurrencyCode =>
  CURRENCIES.some((c) => c.code === value);

/** A saved value as a currency code; anything unknown or missing is the default (taka). */
export const currencyCodeOf = (value: unknown): CurrencyCode =>
  isCurrencyCode(value) ? value : DEFAULT_CURRENCY_CODE;

export function currencyOf(code: CurrencyCode | undefined) {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}
