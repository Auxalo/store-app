import type { Sale, SaleItem } from "@/db/local/types";
import type { createFormat } from "@/lib/format";
import { saleStanding } from "@/lib/sale-math";
import type { ReceiptModel } from "./receipt-layout";

type Translate = (key: string, values?: Record<string, string>) => string;

export interface ReceiptModelInput {
  sale: Sale;
  items: SaleItem[];
  storeName: string;
  profile: { name: string; address: string; phone: string };
  /** The shop's own thank-you line, or "" for the default. */
  footer: string;
  /** Words from the "receipt" namespace. */
  t: Translate;
  /** Unit and payment-method names. */
  tu: (unit: string) => string;
  tp: (method: string) => string;
  f: ReturnType<typeof createFormat>;
}

/**
 * What the printed receipt says, as rows of plain text: the same content as the paper receipt on
 * screen (src/components/pos/receipt.tsx), in the current language.
 */
export function buildReceiptModel(input: ReceiptModelInput): ReceiptModel {
  const { sale, items, t, tu, tp, f } = input;
  const money = (n: number) => f.money(n, "always");
  const header = [input.profile.name || input.storeName];
  if (input.profile.address) header.push(input.profile.address);
  if (input.profile.phone) header.push(input.profile.phone);

  const meta = [
    `${t("invoice")}: ${sale.invoiceNo}`,
    `${t("date")}: ${f.dateTime(sale.createdAt)}`,
  ];
  if (sale.customerName) meta.push(`${t("customer")}: ${sale.customerName}`);

  const totals: ReceiptModel["totals"] = [
    { label: t("subtotal"), value: money(sale.subtotal) },
  ];
  if (sale.discount > 0)
    totals.push({ label: t("discount"), value: `− ${money(sale.discount)}` });
  totals.push({ label: t("total"), value: money(sale.total), bold: true });
  if ((sale.creditUsed ?? 0) > 0)
    totals.push({
      label: t("paidFromCredit"),
      value: money(sale.creditUsed ?? 0),
    });
  if ((sale.tendered ?? 0) > sale.paid)
    totals.push({ label: t("received"), value: money(sale.tendered ?? 0) });
  totals.push({ label: t("paid"), value: money(sale.paid) });
  if ((sale.toAccount ?? 0) > 0)
    totals.push({ label: t("toAccount"), value: money(sale.toAccount ?? 0) });
  const change = (sale.tendered ?? 0) - sale.paid - (sale.toAccount ?? 0);
  if (change > 0) totals.push({ label: t("change"), value: money(change) });
  if (sale.due > 0)
    totals.push({ label: t("due"), value: money(sale.due), bold: true });
  totals.push({ label: t("method"), value: tp(sale.paymentMethod) });

  const standing: ReceiptModel["standing"] = [];
  if (sale.customerId) {
    const { before, after } = saleStanding(sale);
    if (before > 0)
      standing.push({ label: t("previousDue"), value: money(before) });
    if (before > 0 && after >= 0)
      standing.push({
        label: t("totalDue"),
        value: money(after),
        bold: true,
      });
    if (after < 0)
      standing.push({ label: t("advance"), value: money(-after), bold: true });
  }

  return {
    header,
    cancelled: sale.status === "voided" ? t("cancelled") : undefined,
    meta,
    items: items.map((item) => ({
      name: item.productName,
      detail: `${f.qty(item.qty)} ${tu(item.unit)} × ${f.money(item.unitPrice)}${
        item.discount > 0 ? ` − ${f.money(item.discount)}` : ""
      }`,
      amount: money(item.lineTotal),
    })),
    totals,
    standing,
    footer: input.footer || t("thanks"),
  };
}
