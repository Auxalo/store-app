import { returnSplit } from "@/lib/refund";
import { dayKey } from "./compute";

/**
 * The cash drawer's day: what came in and went out in cash, and what should be in the drawer now.
 * ONE function over plain records, used by the device and by the server, so they cannot disagree
 * (see src/reports/__tests__/cash.test.ts). The day of a movement is the day it was made, in the
 * shop's time zone. A sale, payment or expense that is cancelled later is counted back on the day it
 * was cancelled, so earlier days never change.
 */

export interface CashSale {
  paid: number;
  paymentMethod: string;
  status?: string;
  createdAt: string;
  voidedAt?: string | null;
}
export interface CashPayment {
  partyType: "customer" | "supplier";
  amount: number;
  method: string;
  status?: string;
  createdAt: string;
  voidedAt?: string | null;
}
export interface CashExpense {
  amount: number;
  method: string;
  status?: string;
  createdAt: string;
  /** An expense has no cancel date: when it is cancelled, this moves. */
  updatedAt: string;
}
export interface CashPurchase {
  paid: number;
  paymentMethod: string;
  createdAt: string;
}
export interface CashReturn {
  kind: "sale" | "purchase";
  total: number;
  cashBack?: number;
  credited?: number;
  settlement?: "cash" | "credit";
  createdAt: string;
}

export interface CashInputs {
  /** Created in the day, or cancelled in it. */
  sales: CashSale[];
  payments: CashPayment[];
  expenses: CashExpense[];
  purchases: CashPurchase[];
  returns: CashReturn[];
}

export interface CashFlow {
  /** Cash sales (less cash sales cancelled today). */
  sales: number;
  /** Dues collected from customers in cash (less those cancelled today). */
  customerPayments: number;
  /** Cash that suppliers gave back on purchase returns. */
  supplierRefunds: number;
  /** Cash handed back to customers on returns. */
  customerRefunds: number;
  /** Purchases paid in cash. */
  purchases: number;
  /** Suppliers paid in cash (less those cancelled today). */
  supplierPayments: number;
  /** Expenses paid in cash (less those cancelled today). */
  expenses: number;
  totalIn: number;
  totalOut: number;
}

export interface CashEntryRow {
  id: string;
  day: string;
  amount: number;
  kind: "open" | "correct";
  note: string;
  byName: string;
  createdAt: string;
}

export interface CashReport {
  day: string;
  /** Today's entries, oldest first: the opening, then any corrections. */
  entries: CashEntryRow[];
  /** The day's figure (its latest entry), or null while nobody has set it. */
  opening: number | null;
  flow: CashFlow;
  /** opening (0 while not set) + in − out. */
  expected: number;
  /** The days before, newest first, with the opening each ended up with. */
  history: Array<{ day: string; opening: number; entries: number }>;
}

const isCash = (method: string) => method === "cash";

export function cashFlow(
  day: string,
  timeZone: string,
  input: CashInputs,
): CashFlow {
  const on = (iso: string | null | undefined) =>
    !!iso && dayKey(iso, timeZone) === day;

  let sales = 0;
  for (const s of input.sales) {
    if (!isCash(s.paymentMethod)) continue;
    if (on(s.createdAt)) sales += s.paid;
    if (s.status === "voided" && on(s.voidedAt)) sales -= s.paid;
  }
  let customerPayments = 0;
  let supplierPayments = 0;
  for (const p of input.payments) {
    if (!isCash(p.method)) continue;
    const net =
      (on(p.createdAt) ? p.amount : 0) -
      (p.status === "voided" && on(p.voidedAt) ? p.amount : 0);
    if (p.partyType === "customer") customerPayments += net;
    else supplierPayments += net;
  }
  let expenses = 0;
  for (const e of input.expenses) {
    if (!isCash(e.method)) continue;
    if (on(e.createdAt)) expenses += e.amount;
    if (e.status === "voided" && on(e.updatedAt)) expenses -= e.amount;
  }
  let purchases = 0;
  for (const p of input.purchases)
    if (isCash(p.paymentMethod) && on(p.createdAt)) purchases += p.paid;
  let customerRefunds = 0;
  let supplierRefunds = 0;
  for (const r of input.returns) {
    if (!on(r.createdAt)) continue;
    const cash = returnSplit(r).cashBack;
    if (r.kind === "sale") customerRefunds += cash;
    else supplierRefunds += cash;
  }

  const totalIn = sales + customerPayments + supplierRefunds;
  const totalOut = customerRefunds + purchases + supplierPayments + expenses;
  return {
    sales,
    customerPayments,
    supplierRefunds,
    customerRefunds,
    purchases,
    supplierPayments,
    expenses,
    totalIn,
    totalOut,
  };
}

/** The day's figure and log from the entries of the last days (any order). */
export function buildCash(
  day: string,
  timeZone: string,
  input: CashInputs,
  recentEntries: CashEntryRow[],
): CashReport {
  const byTime = (a: CashEntryRow, b: CashEntryRow) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  const today = recentEntries.filter((e) => e.day === day).sort(byTime);
  const opening = today.length > 0 ? today[today.length - 1].amount : null;
  const flow = cashFlow(day, timeZone, input);

  const days = new Map<string, CashEntryRow[]>();
  for (const e of recentEntries) {
    if (e.day === day) continue;
    days.set(e.day, [...(days.get(e.day) ?? []), e]);
  }
  const history = [...days.entries()]
    .map(([d, rows]) => {
      const sorted = rows.sort(byTime);
      return {
        day: d,
        opening: sorted[sorted.length - 1].amount,
        entries: sorted.length,
      };
    })
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  return {
    day,
    entries: today,
    opening,
    flow,
    expected: (opening ?? 0) + flow.totalIn - flow.totalOut,
    history,
  };
}
