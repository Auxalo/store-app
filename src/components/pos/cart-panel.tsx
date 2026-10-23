"use client";

import { Pause, Play, ShoppingCart, Trash2, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRecord } from "@/data/hooks";
import { useUnits } from "@/hooks/use-units";
import { useFormat } from "@/i18n/use-format";
import { keepInView } from "@/lib/focus";
import { computeTotals, priceCut as cutOf, lineAmount } from "@/lib/sale-math";
import { cn } from "@/lib/utils";
import { PAYMENT_METHODS, type PaymentMethod } from "@/schemas/sale";
import { useCart } from "@/stores/cart";
import { CustomerPicker } from "./customer-picker";
import { MoneyField } from "./money-field";
import { QtyInput } from "./qty-input";
import type { useCompleteSale } from "./use-complete-sale";

/** Rounds the total up to the next note a customer would hand over (50, 100, 500, 1000 taka). */
function suggestions(total: number): number[] {
  const out = new Set<number>();
  for (const step of [5_000, 10_000, 50_000, 100_000]) {
    const amount = Math.ceil(total / step) * step;
    if (amount > total) out.add(amount);
  }
  return [...out].slice(0, 3);
}

type Sale = ReturnType<typeof useCompleteSale>;

export function CartPanel({
  sale,
  onOpenCustomer,
  customerOpen,
  onCustomerOpenChange,
}: {
  sale: Sale;
  onOpenCustomer: () => void;
  customerOpen: boolean;
  onCustomerOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const { name: unitName } = useUnits();
  const f = useFormat();
  const { role } = useProfile();
  const cart = useCart();
  const {
    totals,
    needsCustomer,
    discountTooBig,
    canComplete,
    saving,
    complete,
  } = sale;
  // The customer's balance, read fresh: a negative balance is store credit that pays first.
  const buyer = useRecord("customers", cart.customerId);
  const buyerBalance = (buyer.record as { balance?: number } | undefined)
    ?.balance;
  const setCredit = cart.setCredit;
  useEffect(() => {
    if (cart.customerId && buyerBalance !== undefined)
      setCredit(Math.max(0, -buyerBalance));
  }, [cart.customerId, buyerBalance, setCredit]);
  const toPay = totals.total - totals.creditUsed;
  // The same product can be on several lines: the warning looks at all of them together.
  const inCart = (productId: string) =>
    cart.lines
      .filter((l) => l.productId === productId)
      .reduce((sum, l) => sum + l.qty, 0);

  const canOverridePrice = can(role, "sale.priceOverride");
  // What the cashier took off by lowering prices (a raised price is not a discount): it is shown in
  // the Discount field together with any discount typed there, and it is what the invoice shows too.
  const priceCut = cart.lines.reduce((sum, l) => sum + cutOf(l), 0);
  const shownDiscount = cart.discount + priceCut;
  // Change is what was handed over beyond what is to be paid (the total less store credit used).
  const extra = cart.tendered !== null ? Math.max(0, cart.tendered - toPay) : 0;
  // A known customer's extra may stay on their account: it comes off what they owe first, and the
  // rest is their advance. Otherwise it is given back as change.
  const keeping = cart.keepExtra && !!cart.customerId && extra > 0;
  const change = keeping ? 0 : extra;
  const keepOffDue = Math.min(extra, Math.max(0, buyerBalance ?? 0));
  const keepAdvance = extra - keepOffDue;
  const itemCount = cart.lines.length;
  const lineName = (l: { productName: string }) => l.productName;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3"
      data-testid="cart-panel"
    >
      <div className="flex items-center gap-2">
        <ShoppingCart className="size-5" aria-hidden />
        <h2 className="flex-1 text-base font-semibold">
          {t("pos.cart")}
          {itemCount > 0 ? (
            <span className="ms-2 text-sm font-normal text-muted-foreground">
              {t("pos.items", { count: itemCount, n: f.integer(itemCount) })}
            </span>
          ) : null}
        </h2>
        {cart.held.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Play aria-hidden />
                {t("pos.onHold")} ({f.integer(cart.held.length)})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {cart.held.map((h) => (
                <DropdownMenuItem key={h.id} onSelect={() => cart.resume(h.id)}>
                  {f.time(h.heldAt)} ·{" "}
                  {t("pos.items", {
                    count: h.lines.length,
                    n: f.integer(h.lines.length),
                  })}{" "}
                  · {f.money(computeTotals(h.lines, h.discount, 0).total)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {itemCount > 0 ? (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => cart.hold()}
              disabled={saving}
              aria-label={t("pos.hold")}
            >
              <Pause aria-hidden />
              <span className="max-sm:sr-only">{t("pos.hold")}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => cart.clear()}
              disabled={saving}
              aria-label={t("pos.clearCart")}
            >
              <Trash2 aria-hidden />
            </Button>
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="cart-lines">
        {itemCount === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("pos.emptyCart")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cart.lines.map((line) => (
              <li
                key={line.key}
                className="rounded-xl border bg-card p-2.5"
                data-testid="cart-line"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {lineName(line)}
                  </p>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                    aria-label={t("pos.remove")}
                    disabled={saving}
                    onClick={() => cart.removeLine(line.key)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <QtyInput line={line} />
                  <div className="flex items-center gap-1.5 text-sm">
                    {canOverridePrice ? (
                      <MoneyField
                        aria-label={t("pos.unitPrice")}
                        value={line.unitPrice}
                        onValue={(v) =>
                          v !== null && cart.setUnitPrice(line.key, v)
                        }
                        onFocus={keepInView}
                        className="h-8 w-20 px-1.5 text-end text-sm"
                      />
                    ) : (
                      <span className="text-muted-foreground">
                        {f.money(line.unitPrice)}
                      </span>
                    )}
                    <span className="min-w-16 text-end font-semibold">
                      {f.money(lineAmount(line))}
                    </span>
                  </div>
                </div>
                {line.unitPrice !== line.listPrice ? (
                  <p className="mt-1 text-xs text-amber-600">
                    {t("pos.overrideHint", { value: f.money(line.listPrice) })}
                  </p>
                ) : null}
                {line.stock !== undefined &&
                inCart(line.productId) > Math.max(line.stock, 0) ? (
                  <p
                    className="mt-1 text-xs text-amber-600"
                    role="status"
                    data-testid="stock-warning"
                  >
                    {line.stock <= 0
                      ? t("pos.noStockHint")
                      : t("pos.stockHint", {
                          stock: `${f.qty(line.stock)} ${unitName(line.unit)}`,
                        })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t pt-3">
        <Button
          variant="outline"
          className="justify-start"
          onClick={onOpenCustomer}
          data-testid="customer-button"
        >
          <User aria-hidden />
          <span className="truncate">
            {cart.customerId ? cart.customerName : t("pos.walkIn")}
          </span>
        </Button>

        {cart.customerId && cart.credit > 0 ? (
          <div
            className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-sm"
            data-testid="store-credit"
          >
            <Checkbox
              id="use-credit"
              checked={cart.useCredit}
              onCheckedChange={(v) => cart.setUseCredit(v === true)}
              disabled={saving}
              data-testid="use-credit"
            />
            <label htmlFor="use-credit" className="min-w-0 flex-1">
              {t("pos.useCredit", { value: f.money(cart.credit) })}
            </label>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>{t("pos.discount")} (৳)</span>
            <MoneyField
              aria-label={t("pos.discount")}
              value={shownDiscount === 0 ? null : shownDiscount}
              onValue={(v) =>
                cart.setDiscount(Math.max(0, (v ?? 0) - priceCut))
              }
              onFocus={keepInView}
              className="h-9 text-sm md:h-8"
              aria-invalid={discountTooBig}
              data-testid="discount-input"
            />
            {priceCut > 0 ? (
              <span
                className="text-[11px] leading-tight text-amber-600"
                data-testid="discount-price-cut"
              >
                {t("pos.discountIncludesCut", { value: f.money(priceCut) })}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>{t("pos.paymentMethod")}</span>
            <Select
              value={cart.paymentMethod}
              onValueChange={(v) => cart.setPaymentMethod(v as PaymentMethod)}
            >
              <SelectTrigger
                className="h-9 w-full text-sm md:h-8"
                aria-label={t("pos.paymentMethod")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`payment.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{t("pos.received")} (৳)</span>
            <MoneyField
              aria-label={t("pos.received")}
              value={cart.tendered}
              onValue={(v) => cart.setTendered(v)}
              onFocus={keepInView}
              placeholder={String(toPay / 100)}
              className="h-9 text-sm md:h-8"
              data-testid="received-input"
            />
          </div>
          {itemCount > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant={cart.tendered === null ? "default" : "outline"}
                onClick={() => cart.setTendered(null)}
              >
                {t("pos.exact")}
              </Button>
              {suggestions(toPay).map((amount) => (
                <Button
                  key={amount}
                  size="sm"
                  variant="outline"
                  onClick={() => cart.setTendered(amount)}
                >
                  {f.money(amount)}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        {cart.customerId && extra > 0 ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 text-sm"
            data-testid="keep-extra"
          >
            <Checkbox
              id="keep-extra"
              checked={cart.keepExtra}
              onCheckedChange={(v) => cart.setKeepExtra(v === true)}
              disabled={saving}
              data-testid="keep-extra-check"
            />
            <label htmlFor="keep-extra" className="min-w-0 flex-1">
              {t("pos.keepOnAccount", { value: f.money(extra) })}
              <span className="block text-xs text-muted-foreground">
                {[
                  keepOffDue > 0
                    ? t("pos.keptOffDue", { value: f.money(keepOffDue) })
                    : "",
                  keepAdvance > 0
                    ? t("pos.keptAdvance", { value: f.money(keepAdvance) })
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </label>
          </div>
        ) : null}

        <dl className="space-y-0.5 text-sm">
          {totals.discount + priceCut > 0 ? (
            <Row label={t("pos.subtotal")}>
              {f.money(totals.subtotal + priceCut)}
            </Row>
          ) : null}
          {totals.discount + priceCut > 0 ? (
            <Row label={t("pos.discount")}>
              −{f.money(totals.discount + priceCut)}
            </Row>
          ) : null}
          <div className="flex items-center justify-between text-lg font-semibold">
            <dt>{t("pos.total")}</dt>
            <dd data-testid="cart-total">{f.money(totals.total)}</dd>
          </div>
          {totals.creditUsed > 0 ? (
            <Row label={t("pos.paidFromCredit")} testId="credit-used">
              −{f.money(totals.creditUsed)}
            </Row>
          ) : null}
          {change > 0 ? (
            <Row label={t("pos.change")} strong testId="change">
              {f.money(change)}
            </Row>
          ) : null}
          {keeping ? (
            <Row label={t("pos.keptOnAccount")} strong testId="kept-on-account">
              {f.money(extra)}
            </Row>
          ) : null}
          {totals.due > 0 ? (
            <Row label={t("pos.due")} strong testId="due">
              {f.money(totals.due)}
            </Row>
          ) : null}
        </dl>
        {needsCustomer ? (
          <p className="text-xs text-destructive">
            {t("pos.dueNeedsCustomer")}
          </p>
        ) : null}
        {discountTooBig ? (
          <p
            className="text-xs text-destructive"
            role="alert"
            data-testid="discount-too-big"
          >
            {t("pos.discountTooBig", { value: f.money(totals.subtotal) })}
          </p>
        ) : null}

        <Button
          size="lg"
          className="h-12 text-base"
          disabled={!canComplete}
          onClick={() => void complete()}
          data-testid="complete-sale"
        >
          {saving
            ? t("pos.saving")
            : `${t("pos.completeSale")} · ${f.money(totals.total)}`}
        </Button>
      </div>

      <CustomerPicker open={customerOpen} onOpenChange={onCustomerOpenChange} />
    </div>
  );
}

function Row({
  label,
  children,
  strong,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between",
        strong && "font-semibold",
      )}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-testid={testId}>{children}</dd>
    </div>
  );
}
