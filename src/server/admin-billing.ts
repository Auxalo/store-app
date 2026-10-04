import { TZDate } from "@date-fns/tz";
import type { Db } from "mongodb";
import type { PaymentMethod, PaymentStatus } from "@/billing/plans";
import { type BillingDoc, billingStateOf } from "@/billing/state";
import { DEFAULT_TIME_ZONE, PLATFORM_STORE_ID } from "@/lib/constants";
import type { PaymentDoc } from "./billing";
import { getPlatformBilling } from "./billing-settings";

/** The operator's view of billing across all shops: payments, money in, shops that need a look. */

const iso = (d: Date | null | undefined) =>
  d instanceof Date ? d.toISOString() : null;

export interface PaymentRow {
  id: string;
  storeId: string;
  storeName: string;
  amount: number;
  method: PaymentMethod;
  trxId: string;
  sender: string;
  planId: string | null;
  months: number;
  status: PaymentStatus;
  submittedAt: string | null;
  submittedBy: string;
  reviewedAt: string | null;
  reviewedBy: string;
  reason: string;
  note: string;
  periodEnd: string | null;
}

/** The first moment of a Dhaka calendar month, `offset` months from the one `at` is in. */
function monthStart(at: Date, offset = 0): Date {
  const local = new TZDate(at.getTime(), DEFAULT_TIME_ZONE);
  return new Date(
    new TZDate(
      local.getFullYear(),
      local.getMonth() + offset,
      1,
      DEFAULT_TIME_ZONE,
    ).getTime(),
  );
}

/** "2026-10" -> that Dhaka month, as [start, end). */
export function monthRange(month: string): [Date, Date] {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(new TZDate(y, m - 1, 1, DEFAULT_TIME_ZONE).getTime());
  return [start, monthStart(start, 1)];
}

async function namesOf(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .collection<{ _id: string; name?: string }>("stores")
    .find({ _id: { $in: [...new Set(ids)] } })
    .project<{ _id: string; name?: string }>({ name: 1 })
    .toArray();
  return new Map(rows.map((r) => [r._id, String(r.name ?? "")]));
}

/** Payments, newest first (the waiting ones oldest first: that is the order to check them in). */
export async function listPayments(
  db: Db,
  options: {
    status?: PaymentStatus;
    month?: string;
    storeId?: string;
    limit?: number;
  } = {},
): Promise<PaymentRow[]> {
  const filter: Record<string, unknown> = {};
  if (options.status) filter.status = options.status;
  if (options.storeId) filter.storeId = options.storeId;
  if (options.month) {
    const [from, to] = monthRange(options.month);
    filter.submittedAt = { $gte: from, $lt: to };
  }
  const rows = await db
    .collection<PaymentDoc>("billingPayments")
    .find(filter)
    .sort({ submittedAt: options.status === "pending" ? 1 : -1 })
    .limit(Math.min(options.limit ?? 200, 2000))
    .toArray();
  const names = await namesOf(
    db,
    rows.map((r) => r.storeId),
  );
  return rows.map((r) => ({
    id: r._id,
    storeId: r.storeId,
    storeName: names.get(r.storeId) ?? "",
    amount: r.amount,
    method: r.method,
    trxId: r.trxId,
    sender: r.sender,
    planId: r.planId,
    months: r.months,
    status: r.status,
    submittedAt: iso(r.submittedAt),
    submittedBy: r.submittedBy?.name ?? "",
    reviewedAt: iso(r.reviewedAt),
    reviewedBy: r.reviewedBy?.name ?? "",
    reason: r.reason ?? "",
    note: r.note ?? "",
    periodEnd: iso(r.periodEnd),
  }));
}

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  // Quote everything; a leading = + - @ would be read as a formula by a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** The payments as a spreadsheet (amounts in taka). */
export function paymentsCsv(rows: PaymentRow[]): string {
  const header = [
    "Submitted",
    "Shop",
    "Amount (BDT)",
    "Method",
    "TrxID",
    "Sender",
    "Months",
    "Status",
    "Reviewed",
    "Reviewed by",
    "Paid until",
    "Reason / note",
  ];
  const lines = rows.map((r) =>
    [
      r.submittedAt,
      r.storeName,
      (r.amount / 100).toFixed(2),
      r.method,
      r.trxId,
      r.sender,
      r.months,
      r.status,
      r.reviewedAt,
      r.reviewedBy,
      r.periodEnd?.slice(0, 10),
      r.reason || r.note,
    ]
      .map(csvCell)
      .join(","),
  );
  return `${[header.map(csvCell).join(","), ...lines].join("\r\n")}\r\n`;
}

export interface AttentionRow {
  id: string;
  name: string;
  state: string;
  paidUntil: string | null;
  lockAt: string | null;
  lastSeenAt: string | null;
}

/** The numbers and lists on the operator's first page. */
export async function billingOverview(db: Db, now = new Date()) {
  const settings = await getPlatformBilling(db);
  const [stores, pending, collected, lastSeen] = await Promise.all([
    db
      .collection<{
        _id: string;
        name?: string;
        status?: string;
        billing?: BillingDoc;
      }>("stores")
      .find({ _id: { $ne: PLATFORM_STORE_ID } })
      .project<{
        _id: string;
        name?: string;
        status?: string;
        billing?: BillingDoc;
      }>({ name: 1, status: 1, billing: 1 })
      .toArray(),
    db
      .collection<PaymentDoc>("billingPayments")
      .countDocuments({ status: "pending" }),
    db
      .collection<PaymentDoc>("billingPayments")
      .aggregate<{ _id: string; total: number; n: number }>([
        {
          $match: {
            status: "approved",
            reviewedAt: { $gte: monthStart(now, -1) },
          },
        },
        {
          $group: {
            _id: {
              $cond: [
                { $gte: ["$reviewedAt", monthStart(now)] },
                "this",
                "last",
              ],
            },
            total: { $sum: "$amount" },
            n: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    db
      .collection("devices")
      .aggregate<{ _id: string; last: Date }>([
        { $group: { _id: "$storeId", last: { $max: "$lastSeenAt" } } },
      ])
      .toArray(),
  ]);

  const seen = new Map(lastSeen.map((d) => [String(d._id), d.last]));
  const byState: Record<string, number> = {
    off: 0,
    free: 0,
    trial: 0,
    active: 0,
    ending: 0,
    overdue: 0,
    locked: 0,
  };
  let paused = 0;
  let monthly = 0;
  const ending: AttentionRow[] = [];
  const overdue: AttentionRow[] = [];
  const locked: AttentionRow[] = [];
  const quiet: AttentionRow[] = [];
  const quietBefore = now.getTime() - 14 * 86_400_000;

  for (const s of stores) {
    const status = billingStateOf(s.billing, now);
    byState[status.state]++;
    if (s.status === "suspended") paused++;
    const row: AttentionRow = {
      id: s._id,
      name: String(s.name ?? ""),
      state: status.state,
      paidUntil: iso(status.paidUntil),
      lockAt: iso(status.lockAt),
      lastSeenAt: iso(seen.get(s._id)),
    };
    if (status.state === "ending") ending.push(row);
    if (status.state === "overdue") overdue.push(row);
    if (status.state === "locked") locked.push(row);
    const last = seen.get(s._id);
    if (status.mode !== "off" && (!last || last.getTime() < quietBefore))
      quiet.push(row);
    // What a month of paying shops brings in, at their own price (trials and locked shops not counted).
    if (status.mode === "paid" && s.billing?.paidOnce && !status.locked) {
      const plan = settings.plans.find((p) => p.id === s.billing?.planId);
      const price =
        typeof s.billing.price === "number" ? s.billing.price : plan?.price;
      if (price && plan?.months) monthly += price / plan.months;
    }
  }
  const byDate = (a: AttentionRow, b: AttentionRow) =>
    (a.paidUntil ?? "").localeCompare(b.paidUntil ?? "");
  const money = (key: string) =>
    collected.find((c) => c._id === key) ?? { total: 0, n: 0 };

  return {
    shops: { total: stores.length, paused, byState },
    pending,
    collected: {
      thisMonth: money("this").total,
      thisMonthCount: money("this").n,
      lastMonth: money("last").total,
      lastMonthCount: money("last").n,
    },
    expectedMonthly: Math.round(monthly),
    attention: {
      ending: ending.sort(byDate).slice(0, 20),
      overdue: overdue.sort(byDate).slice(0, 20),
      locked: locked.sort(byDate).slice(0, 20),
      quiet: quiet.slice(0, 20),
    },
  };
}
