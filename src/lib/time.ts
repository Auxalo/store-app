import { TZDate } from "@date-fns/tz";
import { endOfDay, startOfDay } from "date-fns";

import { DEFAULT_TIME_ZONE } from "./constants";

/** Start of the store's business day (in `timeZone`) containing `at`, as a UTC Date. */
const toMs = (at: Date | number) =>
  typeof at === "number" ? at : at.getTime();

export function startOfStoreDay(
  at: Date | number,
  timeZone = DEFAULT_TIME_ZONE,
): Date {
  return new Date(startOfDay(new TZDate(toMs(at), timeZone)).getTime());
}

export function endOfStoreDay(
  at: Date | number,
  timeZone = DEFAULT_TIME_ZONE,
): Date {
  return new Date(endOfDay(new TZDate(toMs(at), timeZone)).getTime());
}
