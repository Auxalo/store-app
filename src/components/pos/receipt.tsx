"use client";

import { useTranslations } from "next-intl";
import type { StoreProfile } from "@/components/settings/settings-screen";
import type { Sale, SaleItem } from "@/db/local/types";
import { useSetting } from "@/hooks/use-setting";
import { useFormat } from "@/i18n/use-format";
import { cn } from "@/lib/utils";
import { type ReceiptPaper, usePreferences } from "@/stores/preferences";

const PAPER: Record<
  ReceiptPaper,
  { page: string; width: string; text: string }
> = {
  "58mm": { page: "58mm auto", width: "max-w-[58mm]", text: "text-[11px]" },
  "80mm": { page: "80mm auto", width: "max-w-[80mm]", text: "text-xs" },
  a4: { page: "A4", width: "max-w-[190mm]", text: "text-sm" },
};

const NO_PROFILE: StoreProfile = { name: "", address: "", phone: "" };

interface ReceiptProps {
  sale: Sale;
  items: SaleItem[];
  storeName: string;
}

/**
 * The receipt, in the current language. Works offline (it only reads the device database) and
 * prints on thermal paper (58/80 mm) or A4: everything else on the page is hidden when printing.
 */
export function Receipt({ sale, items, storeName }: ReceiptProps) {
  const t = useTranslations("receipt");
  const tu = useTranslations("units");
  const tp = useTranslations("payment");
  const f = useFormat();
  const paper = usePreferences((s) => s.receiptPaper);
  const size = PAPER[paper];
  const profile = useSetting<StoreProfile>("store.profile", NO_PROFILE).value;
  const footer = useSetting<string>("receipt.footer", "").value;
  const itemName = (i: SaleItem) => i.productName;

  return (
    <div
      id="print-receipt"
      className={cn(
        "mx-auto w-full bg-white p-3 font-mono text-black",
        size.width,
        size.text,
      )}
    >
      <style media="print">{`@page { size: ${size.page}; margin: 3mm; }`}</style>

      <div className="text-center">
        <p className="text-base font-bold">{profile.name || storeName}</p>
        {profile.address ? <p>{profile.address}</p> : null}
        {profile.phone ? <p>{profile.phone}</p> : null}
        {sale.status === "voided" ? (
          <p className="mt-1 border border-black px-1 font-bold">
            {t("cancelled")}
          </p>
        ) : null}
      </div>

      <div className="my-2 border-y border-dashed border-black py-1">
        <p>
          {t("invoice")}: <span className="font-bold">{sale.invoiceNo}</span>
        </p>
        <p>
          {t("date")}: {f.dateTime(sale.createdAt)}
        </p>
        {sale.customerName ? (
          <p>
            {t("customer")}: {sale.customerName}
          </p>
        ) : null}
      </div>

      <table className="w-full">
        <thead>
          <tr className="border-b border-black text-start">
            <th className="py-0.5 text-start font-semibold">{t("item")}</th>
            <th className="py-0.5 text-end font-semibold">{t("qty")}</th>
            <th className="py-0.5 text-end font-semibold">{t("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="py-0.5 pe-1">
                <div>{itemName(item)}</div>
                <div className="opacity-70">
                  {f.money(item.unitPrice)}
                  {item.discount > 0 ? ` − ${f.money(item.discount)}` : ""}
                </div>
              </td>
              <td className="whitespace-nowrap py-0.5 text-end">
                {f.qty(item.qty)} {tu(item.unit)}
              </td>
              <td className="whitespace-nowrap py-0.5 text-end">
                {f.money(item.lineTotal, "always")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 space-y-0.5 border-t border-dashed border-black pt-1">
        <Line label={t("subtotal")} value={f.money(sale.subtotal, "always")} />
        {sale.discount > 0 ? (
          <Line
            label={t("discount")}
            value={`− ${f.money(sale.discount, "always")}`}
          />
        ) : null}
        <Line label={t("total")} value={f.money(sale.total, "always")} bold />
        {(sale.creditUsed ?? 0) > 0 ? (
          <Line
            label={t("paidFromCredit")}
            value={f.money(sale.creditUsed ?? 0, "always")}
          />
        ) : null}
        <Line label={t("paid")} value={f.money(sale.paid, "always")} />
        {sale.due > 0 ? (
          <Line label={t("due")} value={f.money(sale.due, "always")} bold />
        ) : null}
        <Line label={t("method")} value={tp(sale.paymentMethod)} />
      </div>

      <p className="mt-3 text-center">{footer || t("thanks")}</p>
    </div>
  );
}

function Line({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div
      className={cn("flex justify-between gap-2", bold && "text-sm font-bold")}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
