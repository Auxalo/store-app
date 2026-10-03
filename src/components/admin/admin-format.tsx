"use client";

import type { BillingState } from "@/billing/state";
import { cn } from "@/lib/utils";

/** Dates and money in the operator panel: Dhaka time, taka. */

const DHAKA = "Asia/Dhaka";

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: DHAKA,
});
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: DHAKA,
});
const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: DHAKA });

export const when = (iso: string | null | undefined) =>
  iso ? dateTimeFmt.format(new Date(iso)) : "—";

export const day = (iso: string | null | undefined) =>
  iso ? dayFmt.format(new Date(iso)) : "—";

/** "2026-10-31" (Dhaka) for a date input. */
export const dayKey = (iso: string | null | undefined) =>
  iso ? keyFmt.format(new Date(iso)) : "";

export const thisMonth = () => keyFmt.format(new Date()).slice(0, 7);

export const taka = (poisha: number | null | undefined) =>
  poisha === null || poisha === undefined
    ? "—"
    : `৳${(poisha / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Taka typed by the operator ("1,200.50") to poisha, or null. */
export function toPoisha(text: string): number | null {
  const n = Number(text.replace(/[,\s৳]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const STATE_LABEL: Record<BillingState, string> = {
  off: "Billing off",
  free: "Free",
  trial: "Trial",
  active: "Active",
  ending: "Ending soon",
  overdue: "Overdue",
  locked: "Locked",
};

const STATE_CLASS: Record<BillingState, string> = {
  off: "bg-muted text-muted-foreground",
  free: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  trial: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  ending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  overdue: "bg-red-500/15 text-red-700 dark:text-red-400",
  locked: "bg-red-600 text-white",
};

export const BILLING_STATES = Object.keys(STATE_LABEL) as BillingState[];
export const stateLabel = (state: BillingState) => STATE_LABEL[state];

export function StateBadge({
  state,
  className,
}: {
  state: BillingState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATE_CLASS[state],
        className,
      )}
      data-state={state}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

export function PaymentBadge({
  status,
}: {
  status: "pending" | "approved" | "rejected";
}) {
  const style =
    status === "approved"
      ? STATE_CLASS.active
      : status === "rejected"
        ? STATE_CLASS.overdue
        : STATE_CLASS.ending;
  const label =
    status === "approved"
      ? "Approved"
      : status === "rejected"
        ? "Rejected"
        : "Waiting";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        style,
      )}
    >
      {label}
    </span>
  );
}
