import { TZDate } from "@date-fns/tz";
import { endOfDay, startOfDay } from "date-fns";
import { DEFAULT_TIME_ZONE } from "@/lib/constants";

/**
 * Billing, as the shop and the server both see it. Pure: the server uses it to refuse a shop whose
 * subscription is overdue, and the device uses the same rules to lock itself on the right day even
 * without internet. Days are Dhaka calendar days; a period ends at the end of its last day.
 *
 *   off     no billing for this shop (every shop made before billing existed)
 *   free    the operator lets this shop use the app for free
 *   paid    trial / active -> ending (a few days left) -> overdue (grace days) -> locked
 */
export type BillingMode = "off" | "free" | "paid";
export type BillingState =
  | "off"
  | "free"
  | "trial"
  | "active"
  | "ending"
  | "overdue"
  | "locked";

/** What is kept on the shop's record (`stores.billing`). Only the operator changes it. */
export interface BillingDoc {
  mode: BillingMode;
  /** The plan the shop is on (from the operator's plan list). */
  planId?: string | null;
  /** A price agreed with this shop for its plan, in poisha (none = the plan's price). */
  price?: number | null;
  /** Last moment of the paid (or trial) period. */
  paidUntil?: Date | null;
  /** Has the shop ever paid (if not, the period it has is a trial). */
  paidOnce?: boolean;
  /** Days after the end before the app locks (none = the operator's default). */
  graceDays?: number | null;
  /** A shop that sent a payment while locked is let in until then, while the operator checks it. */
  provisionalUntil?: Date | null;
  /** The `paidUntil` that opening was given for: once per period. */
  provisionalFor?: Date | null;
  /** Day of the month periods end on (kept so Jan 31 -> Feb 28 -> Mar 31). */
  anchorDay?: number | null;
  /** Worked out from the above whenever billing changes (see `marksFor`). */
  warnFrom?: Date | null;
  lockAt?: Date | null;
}

/** What a device is told (head, pull and the billing endpoint carry it). Dates as ISO strings. */
export interface BillingStamp {
  mode: BillingMode;
  /** The plan's name, for the sidebar (none for a shop without a plan). */
  plan: { name: string; nameBn: string } | null;
  paidOnce: boolean;
  paidUntil: string | null;
  warnFrom: string | null;
  lockAt: string | null;
  provisionalUntil: string | null;
  /** The server's clock when it answered, so a device with a wrong clock can correct itself. */
  serverTime: string;
}

export interface BillingStatus {
  mode: BillingMode;
  state: BillingState;
  /** The period is a trial (the shop has never paid). */
  trial: boolean;
  /** The app is locked: every screen goes to the billing page. */
  locked: boolean;
  /** Let in for now because a payment is waiting to be checked. */
  provisional: boolean;
  /** Whole days left in the period (0 = ends today, negative = days overdue); none when not paid. */
  daysLeft: number | null;
  paidUntil: Date | null;
  lockAt: Date | null;
  provisionalUntil: Date | null;
}

const DAY_MS = 86_400_000;
const TZ = DEFAULT_TIME_ZONE;

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** The Dhaka calendar day of `at` as {year, month (0-11), day}. */
function partsOf(at: Date) {
  const local = new TZDate(at.getTime(), TZ);
  return {
    year: local.getFullYear(),
    month: local.getMonth(),
    day: local.getDate(),
  };
}

const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The last moment of a Dhaka day; days and months past the end roll over, like `Date`. */
const endOfLocalDay = (year: number, month: number, day: number) =>
  new Date(endOfDay(new TZDate(year, month, day, TZ)).getTime());

/** The last moment of the Dhaka day year-month-day, the day clamped to that month (31 -> Feb 28). */
export function endOfDhakaDay(year: number, month: number, day: number): Date {
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return endOfLocalDay(y, m, Math.min(Math.max(day, 1), daysInMonth(y, m)));
}

const startOfDhakaDay = (at: Date) =>
  new Date(startOfDay(new TZDate(at.getTime(), TZ)).getTime());

/** Whole Dhaka calendar days from `from`'s day to `to`'s day (Dhaka has no daylight saving). */
export function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfDhakaDay(to).getTime() - startOfDhakaDay(from).getTime()) / DAY_MS,
  );
}

/** The end of the day `days` days after the day of `at`. */
export function endOfDayPlus(at: Date, days: number): Date {
  const p = partsOf(at);
  return endOfLocalDay(p.year, p.month, p.day + days);
}

/**
 * When the warning starts and when the app locks, for a period ending at `paidUntil`.
 * Warning: `reminderDays` days before the last day. Lock: the end of the last grace day.
 */
export function marksFor(
  paidUntil: Date | null,
  graceDays: number,
  reminderDays: number,
): { warnFrom: Date | null; lockAt: Date | null } {
  if (!paidUntil) return { warnFrom: null, lockAt: null };
  return {
    warnFrom: startOfDhakaDay(endOfDayPlus(paidUntil, -reminderDays)),
    lockAt: endOfDayPlus(paidUntil, Math.max(0, graceDays)),
  };
}

/** Where the shop stands at `now`. Accepts the stored record or what a device was told. */
export function billingStateOf(
  billing:
    | Pick<
        BillingDoc,
        | "mode"
        | "paidOnce"
        | "paidUntil"
        | "warnFrom"
        | "lockAt"
        | "provisionalUntil"
      >
    | BillingStamp
    | null
    | undefined,
  now: Date | number,
): BillingStatus {
  const at = typeof now === "number" ? new Date(now) : now;
  const mode = billing?.mode ?? "off";
  const empty = {
    mode,
    trial: false,
    locked: false,
    provisional: false,
    daysLeft: null,
    paidUntil: null,
    lockAt: null,
    provisionalUntil: null,
  };
  if (!billing || mode === "off") return { ...empty, state: "off" };
  if (mode === "free") return { ...empty, state: "free" };

  const paidUntil = toDate(billing.paidUntil);
  const lockAt = toDate(billing.lockAt);
  const warnFrom = toDate(billing.warnFrom);
  const provisionalUntil = toDate(billing.provisionalUntil);
  const trial = !billing.paidOnce;
  const provisional = !!provisionalUntil && at < provisionalUntil;
  const daysLeft = paidUntil ? calendarDaysBetween(at, paidUntil) : null;
  const pastLock = !lockAt || at >= lockAt;

  const state: BillingState =
    pastLock && !provisional
      ? "locked"
      : paidUntil && at > paidUntil
        ? "overdue"
        : warnFrom && at >= warnFrom
          ? "ending"
          : trial
            ? "trial"
            : "active";
  return {
    mode,
    state,
    trial,
    locked: state === "locked",
    provisional: provisional && pastLock,
    daysLeft,
    paidUntil,
    lockAt,
    provisionalUntil,
  };
}

/**
 * The end of the next period when `months` are paid for at `now`. A shop that is not locked yet
 * continues from where its period ends (paying early loses nothing, paying in the grace days gains
 * nothing); a locked shop starts again from today.
 */
export function nextPeriod(
  billing: Pick<BillingDoc, "paidUntil" | "lockAt" | "anchorDay"> | null,
  months: number,
  now: Date,
): { start: Date; paidUntil: Date; anchorDay: number } {
  const paidUntil = toDate(billing?.paidUntil);
  const lockAt = toDate(billing?.lockAt);
  const continues = !!paidUntil && !!lockAt && now < lockAt;
  const from = continues && paidUntil ? paidUntil : now;
  const p = partsOf(from);
  const anchorDay = continues && billing?.anchorDay ? billing.anchorDay : p.day;
  return {
    start: continues && paidUntil ? new Date(paidUntil.getTime() + 1) : now,
    paidUntil: endOfDhakaDay(p.year, p.month + months, anchorDay),
    anchorDay,
  };
}

/** A transaction id as typed (spaces, dashes, lower case) in the form that is compared. */
export function normalizeTrxId(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase();
}

/**
 * "Now" for a device, as close to the server's clock as it can tell: the device clock corrected by
 * what the server last said, and never earlier than the latest time it has already seen (turning
 * the phone's clock back does not undo a lock).
 */
export function effectiveNow(
  deviceNow: number,
  offsetMs: number | undefined,
  highWater: number | undefined,
): number {
  return Math.max(deviceNow + (offsetMs ?? 0), highWater ?? 0);
}

/** The stored record as a device is told it. */
export function stampOf(
  billing: BillingDoc | null | undefined,
  serverTime: Date,
  plan: BillingStamp["plan"] = null,
): BillingStamp {
  const iso = (d: Date | null | undefined) => toDate(d)?.toISOString() ?? null;
  return {
    mode: billing?.mode ?? "off",
    plan,
    paidOnce: !!billing?.paidOnce,
    paidUntil: iso(billing?.paidUntil),
    warnFrom: iso(billing?.warnFrom),
    lockAt: iso(billing?.lockAt),
    provisionalUntil: iso(billing?.provisionalUntil),
    serverTime: serverTime.toISOString(),
  };
}
