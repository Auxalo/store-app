import type { createFormat } from "@/lib/format";
import type { ReceiptModel } from "./receipt-layout";

type Translate = (key: string, values?: Record<string, string>) => string;

export interface PaymentSlipInput {
  payment: {
    createdAt: string;
    amount: number;
    method: string;
    partyName: string;
  };
  /** What the customer owed just before this payment (poisha), when known. */
  before: number | null;
  /** Where they stand now: more than 0 is due, less than 0 is advance. */
  after: number;
  storeName: string;
  profile: { name: string; address: string; phone: string };
  footer: string;
  /** Words from the "receipt" namespace. */
  t: Translate;
  tp: (method: string) => string;
  f: ReturnType<typeof createFormat>;
}

/**
 * A short payment slip: this payment, and where the customer stands afterwards (still owes, all
 * settled, or holds an advance). Printed on the same paper as a sale receipt.
 */
export function buildPaymentSlipModel(input: PaymentSlipInput): ReceiptModel {
  const { payment, before, after, t, tp, f } = input;
  const money = (n: number) => f.money(n, "always");
  const header = [input.profile.name || input.storeName];
  if (input.profile.address) header.push(input.profile.address);
  if (input.profile.phone) header.push(input.profile.phone);

  const meta = [`${t("date")}: ${f.dateTime(payment.createdAt)}`];
  if (payment.partyName) meta.push(`${t("customer")}: ${payment.partyName}`);

  const standing: ReceiptModel["standing"] = [];
  if (before !== null && before > 0)
    standing.push({ label: t("previousDue"), value: money(before) });
  if (after > 0)
    standing.push({ label: t("dueNow"), value: money(after), bold: true });
  else if (after < 0)
    standing.push({ label: t("advance"), value: money(-after), bold: true });
  else standing.push({ label: t("allSettled"), value: money(0), bold: true });

  return {
    header,
    title: t("paymentTitle"),
    meta,
    items: [],
    totals: [
      {
        label: t("paymentReceived"),
        value: money(payment.amount),
        bold: true,
      },
      { label: t("method"), value: tp(payment.method) },
    ],
    standing,
    footer: input.footer || t("thanks"),
  };
}
