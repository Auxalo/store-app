import { DEFAULT_TIME_ZONE } from "./constants";

/** "2610" for October 2026 in the store's time zone. */
export function yearMonth(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "2-digit",
    month: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}`;
}

/**
 * Numbers issued by the server while a device is online look like "2610-00042" (month, then a
 * counter for the whole shop). Numbers a device issues offline look like "A-2610-0042" (its own
 * code first), so the two kinds can never be the same, whatever happens. `prefix` separates other
 * documents: "P" purchases, "R" sale returns, "PR" purchase returns.
 */
export function onlineNumber(
  prefix: string,
  month: string,
  seq: number,
): string {
  return `${prefix ? `${prefix}-` : ""}${month}-${String(seq).padStart(5, "0")}`;
}

/** Automatic SKUs issued by the server: "00042". (A device issues "A0042".) */
export function onlineSku(seq: number): string {
  return String(seq).padStart(5, "0");
}
