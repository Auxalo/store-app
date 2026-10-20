"use client";

import { Copy, MessageCircle, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import type { StoreProfile } from "@/components/settings/settings-screen";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Sale, SaleItem } from "@/db/local/types";
import { useSetting } from "@/hooks/use-setting";
import { useFormat } from "@/i18n/use-format";
import { normalizePhone } from "@/lib/phone";
import { saleStanding } from "@/lib/sale-math";

const NO_PROFILE: StoreProfile = { name: "", address: "", phone: "" };

/** A number WhatsApp understands: country code first, digits only (01711000001 → 8801711000001). */
export function whatsappNumber(phone: string | undefined): string {
  const digits = normalizePhone(phone ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("880")) return digits;
  if (digits.startsWith("0")) return `88${digits}`;
  return digits;
}

/**
 * Sends the invoice as a message: the phone's own share sheet (WhatsApp, Messenger, SMS ...) where
 * there is one; on a computer a small window with "WhatsApp" (to the customer's number when known)
 * and "copy". It is plain text, so it works offline too and reads well in any chat app.
 */
export function ShareReceiptButton({
  sale,
  items,
  storeName,
  className,
}: {
  sale: Sale;
  items: SaleItem[];
  storeName: string;
  className?: string;
}) {
  const t = useTranslations("receipt");
  const tu = useTranslations("units");
  const tp = useTranslations("payment");
  const f = useFormat();
  const profile = useSetting<StoreProfile>("store.profile", NO_PROFILE).value;
  const footer = useSetting<string>("receipt.footer", "").value;
  const [open, setOpen] = useState(false);

  const text = () => {
    const lines: string[] = [];
    lines.push(profile.name || storeName);
    if (profile.address) lines.push(profile.address);
    if (profile.phone) lines.push(profile.phone);
    lines.push(
      "",
      `${t("invoice")}: ${sale.invoiceNo}`,
      `${t("date")}: ${f.dateTime(sale.createdAt)}`,
    );
    if (sale.customerName) lines.push(`${t("customer")}: ${sale.customerName}`);
    lines.push("--------------------");
    for (const item of items)
      lines.push(
        `${item.productName}  ${f.qty(item.qty)} ${tu(item.unit)} × ${f.money(item.unitPrice)} = ${f.money(item.lineTotal, "always")}`,
      );
    lines.push("--------------------");
    if (sale.discount > 0)
      lines.push(`${t("discount")}: − ${f.money(sale.discount, "always")}`);
    lines.push(`${t("total")}: ${f.money(sale.total, "always")}`);
    if ((sale.creditUsed ?? 0) > 0)
      lines.push(
        `${t("paidFromCredit")}: ${f.money(sale.creditUsed ?? 0, "always")}`,
      );
    lines.push(
      `${t("paid")}: ${f.money(sale.paid, "always")} (${tp(sale.paymentMethod)})`,
    );
    if ((sale.toAccount ?? 0) > 0)
      lines.push(
        `${t("toAccount")}: ${f.money(sale.toAccount ?? 0, "always")}`,
      );
    if (sale.due > 0) lines.push(`${t("due")}: ${f.money(sale.due, "always")}`);
    if (sale.customerId) {
      const { before, after } = saleStanding(sale);
      if (before > 0)
        lines.push(`${t("previousDue")}: ${f.money(before, "always")}`);
      if (before > 0 && after >= 0)
        lines.push(`${t("totalDue")}: ${f.money(after, "always")}`);
      if (after < 0)
        lines.push(`${t("advance")}: ${f.money(-after, "always")}`);
    }
    lines.push("", footer || t("thanks"));
    return lines.join("\n");
  };

  async function share() {
    const message = text();
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: `${t("invoice")} ${sale.invoiceNo}`,
          text: message,
        });
        return;
      } catch (error) {
        // Closing the share sheet is not a failure; anything else falls back to the window.
        if ((error as Error).name === "AbortError") return;
      }
    }
    setOpen(true);
  }

  async function copy(message: string) {
    try {
      await navigator.clipboard.writeText(message);
      toast.success(t("shareCopied"));
    } catch {
      toast.error(t("shareCopyFailed"));
    }
  }

  const message = open ? text() : "";
  const phone = whatsappNumber(sale.customerPhone);
  const whatsapp = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  return (
    <>
      <Button
        variant="outline"
        className={className}
        onClick={() => void share()}
        data-testid="share-receipt"
      >
        <Share2 aria-hidden />
        {t("share")}
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title={t("shareTitle")}
      >
        <div className="flex flex-col gap-3" data-testid="share-dialog">
          <Textarea
            readOnly
            value={message}
            rows={10}
            className="font-mono text-xs"
            aria-label={t("shareTitle")}
            data-testid="share-text"
          />
          <p className="text-xs text-muted-foreground">{t("shareHint")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => void copy(message)}
              data-testid="share-copy"
            >
              <Copy aria-hidden />
              {t("shareCopy")}
            </Button>
            <Button asChild data-testid="share-whatsapp">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                <MessageCircle aria-hidden />
                {phone
                  ? t("shareWhatsappTo", { phone: sale.customerPhone ?? "" })
                  : t("shareWhatsapp")}
              </a>
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </>
  );
}
