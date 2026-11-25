"use client";

import {
  CalendarDays,
  Info,
  PackagePlus,
  PackageSearch,
  Plus,
  ReceiptText,
  ScanBarcode,
  Search,
  Trash2,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useDebounceValue } from "usehooks-ts";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { PartyPicker } from "@/components/parties/party-picker";
import { MoneyField } from "@/components/pos/money-field";
import { BackLink } from "@/components/shared/back-link";
import { QtyField } from "@/components/shared/qty-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCommand, useList, useProductLookup, useRecord } from "@/data/hooks";
import type { Product } from "@/db/local/types";
import { usePaymentMethods } from "@/hooks/use-payment-methods";
import { useUnits } from "@/hooks/use-units";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { lineAmount } from "@/lib/sale-math";
import { cn } from "@/lib/utils";
import { purchaseTotals } from "@/schemas/purchase";
import type { PaymentMethod } from "@/schemas/sale";
import { usePreferences } from "@/stores/preferences";
import { QuickProductDialog } from "./quick-product-dialog";

interface Line {
  key: string;
  product: Product;
  qty: number;
  unitCost: number;
}

/** Today in the store's time zone as yyyy-mm-dd. */
function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function PurchaseFormScreen() {
  const t = useTranslations();
  const methods = usePaymentMethods();
  const { name: unitName } = useUnits();
  const f = useFormat();
  const router = useRouter();
  const run = useCommand();
  const lookup = useProductLookup();
  const { role } = useProfile();
  const timeZone = usePreferences((s) => s.timeZone);

  const [lines, setLines] = useState<Line[]>([]);
  const [supplier, setSupplier] = useState<{ id: string | null; name: string }>(
    { id: null, name: "" },
  );
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [date, setDate] = useState(() => todayIn(timeZone));
  const [discount, setDiscount] = useState<number | null>(null);
  const [paid, setPaid] = useState<number | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [updateCosts, setUpdateCosts] = useState(true);
  const [query, setQuery] = useState("");
  const [deferred] = useDebounceValue(query.trim(), 200);
  const [saving, setSaving] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickText, setQuickText] = useState("");
  const canCreateProduct = can(role, "product.create");

  const found = useList(
    "products",
    { q: deferred, active: "active" },
    { pageSize: 6, enabled: deferred !== "" },
  );
  const results: Product[] = deferred !== "" ? found.items : [];
  // Searched, and the shop has no such product: offer to add it.
  const nothingFound =
    deferred !== "" &&
    deferred === query.trim() &&
    found.status === "ready" &&
    found.items.length === 0;

  const totals = useMemo(
    () =>
      purchaseTotals(
        lines.map((l) => ({ qty: l.qty, unitCost: l.unitCost, discount: 0 })),
        discount ?? 0,
        paid ?? Number.MAX_SAFE_INTEGER,
      ),
    [lines, discount, paid],
  );
  const needsSupplier = totals.due > 0 && !supplier.id;
  // Paid beyond the total: with a supplier chosen, the extra can stay on their account (it comes
  // off what we owe first, and the rest is an advance with them). Ticked by default.
  const [keepExtra, setKeepExtra] = useState(true);
  const supplierRecord = useRecord("suppliers", supplier.id);
  const owedToSupplier = Math.max(
    0,
    (supplierRecord.record as { balance?: number } | undefined)?.balance ?? 0,
  );
  const extra = paid !== null ? Math.max(0, paid - totals.paid) : 0;
  const keepOffDue = Math.min(extra, owedToSupplier);
  const keepAdvance = extra - keepOffDue;
  // Every item needs a cost above zero: a zero would also wipe the product's purchase price.
  const costMissing = lines.some((l) => !(l.unitCost >= 1));
  // A discount bigger than the goods would be quietly cut down to the total: say so, don't save.
  const discountTooBig = (discount ?? 0) > totals.subtotal;
  const canSave =
    lines.length > 0 &&
    !needsSupplier &&
    !costMissing &&
    !discountTooBig &&
    !saving;

  if (!can(role, "purchase.manage"))
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.noAccess")}
      </p>
    );

  const addProduct = (p: Product) => {
    setLines((ls) => {
      const same = ls.find((l) => l.product.id === p.id);
      if (same)
        return ls.map((l) => (l === same ? { ...l, qty: l.qty + 1000 } : l));
      return [
        ...ls,
        { key: newId(), product: p, qty: 1000, unitCost: p.purchasePrice },
      ];
    });
    setQuery("");
  };

  async function onEnter() {
    const exact = await lookup(query).catch(() => null);
    const pick = exact ?? (results.length === 1 ? results[0] : undefined);
    if (pick) addProduct(pick);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const id = newId();
      await run("purchase.create", {
        id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        invoiceRef,
        date,
        lines: lines.map((l) => ({
          productId: l.product.id,
          productName: l.product.name,
          productNameBn: "",
          unit: l.product.unit,
          qty: l.qty,
          unitCost: l.unitCost,
          discount: 0,
        })),
        discount: discount ?? 0,
        paid: paid ?? totals.total,
        toAccount: supplier.id && keepExtra ? extra : 0,
        paymentMethod: method,
        notes,
        updateCosts,
      });
      router.push(`/purchases/view?id=${id}`);
    } catch {
      toast.error(t("common.somethingWrong"));
      setSaving(false);
    }
  }

  const name = (p: Product) => p.name;
  const openQuick = (text: string) => {
    setQuickText(text);
    setQuickOpen(true);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <BackLink href="/purchases" label={t("nav.purchases")} />
      <h2 className="text-lg font-semibold">{t("purchases.add")}</h2>

      <section
        className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4"
        aria-labelledby="purchase-details"
      >
        <h3
          id="purchase-details"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ReceiptText className="size-4 text-primary" aria-hidden />
          {t("purchases.detailsTitle")}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("purchases.supplier")}
            </span>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => setSupplierOpen(true)}
              data-testid="supplier-button"
            >
              <User aria-hidden />
              <span className="truncate">
                {supplier.id ? supplier.name : t("purchases.noSupplier")}
              </span>
            </Button>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="purchase-date"
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
            >
              <CalendarDays className="size-3.5" aria-hidden />
              {t("purchases.date")}
            </label>
            <Input
              id="purchase-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              data-testid="purchase-date"
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label
              htmlFor="purchase-invoice"
              className="text-xs font-medium text-muted-foreground"
            >
              {t("purchases.invoiceRef")}{" "}
              <span className="font-normal">({t("purchases.optional")})</span>
            </label>
            <Input
              id="purchase-invoice"
              value={invoiceRef}
              onChange={(e) => setInvoiceRef(e.target.value)}
              placeholder={t("purchases.invoicePlaceholder")}
              maxLength={60}
              data-testid="purchase-invoice"
            />
          </div>
        </div>
      </section>

      <section
        className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4"
        aria-labelledby="purchase-items"
      >
        <div className="flex items-center justify-between gap-2">
          <h3
            id="purchase-items"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <PackageSearch className="size-4 text-primary" aria-hidden />
            {t("purchases.itemsTitle")}
            {lines.length > 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                {f.integer(lines.length)}
              </span>
            ) : null}
          </h3>
          {canCreateProduct ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openQuick("")}
              data-testid="new-product"
            >
              <Plus aria-hidden />
              {t("purchases.newProduct")}
            </Button>
          ) : null}
        </div>
        <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {canCreateProduct
              ? t("purchases.itemsHint")
              : t("purchases.itemsHintNoCreate")}
          </span>
        </p>

        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onEnter();
                }
              }}
              placeholder={t("purchases.searchProduct")}
              aria-label={t("purchases.searchProduct")}
              className="h-11 ps-9 pe-10"
              inputMode="search"
              autoComplete="off"
              data-testid="purchase-search"
            />
            <ScanBarcode
              className="pointer-events-none absolute end-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground/70"
              aria-hidden
            />
          </div>
          {results && results.length > 0 ? (
            <ul
              className="divide-y overflow-hidden rounded-lg border bg-background shadow-sm"
              data-testid="product-results"
            >
              {results.map((p) => {
                const added = lines.find((l) => l.product.id === p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addProduct(p)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-start hover:bg-muted"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {name(p)}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[
                            p.sku,
                            p.barcode,
                            t("purchases.inStock", {
                              qty: `${f.qty(p.stock)} ${unitName(p.unit)}`,
                            }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block text-sm font-medium">
                          {f.money(p.purchasePrice)}
                        </span>
                        <span className="block text-xs text-primary">
                          {added
                            ? t("purchases.addOneMore")
                            : t("purchases.tapToAdd")}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : nothingFound ? (
            <div
              className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              data-testid="product-not-found"
            >
              <span className="text-muted-foreground">
                {t("purchases.noResults", { q: query.trim() })}
              </span>
              {canCreateProduct ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openQuick(query)}
                  data-testid="add-as-new"
                >
                  <PackagePlus aria-hidden />
                  {t("purchases.addAsNew")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <ul className="flex flex-col gap-2" data-testid="purchase-lines">
          {lines.map((l) => (
            <li
              key={l.key}
              className="rounded-xl border bg-card p-2.5"
              data-testid="purchase-line"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {name(l.product)}
                </p>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t("pos.remove")}
                  onClick={() =>
                    setLines((ls) => ls.filter((x) => x.key !== l.key))
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <QtyField
                    aria-label={t("purchases.qty")}
                    className="h-9 w-20 text-center"
                    value={l.qty}
                    unit={l.product.unit}
                    onValue={(q) =>
                      setLines((ls) =>
                        ls.map((x) => (x.key === l.key ? { ...x, qty: q } : x)),
                      )
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    {unitName(l.product.unit)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {t("purchases.unitCost")}
                  </span>
                  <MoneyField
                    aria-label={t("purchases.unitCost")}
                    className="h-9 w-24 text-end"
                    value={l.unitCost}
                    onValue={(v) =>
                      v !== null &&
                      setLines((ls) =>
                        ls.map((x) =>
                          x.key === l.key ? { ...x, unitCost: v } : x,
                        ),
                      )
                    }
                  />
                </div>
                <span className="ms-auto font-semibold">
                  {f.money(
                    lineAmount({
                      qty: l.qty,
                      unitPrice: l.unitCost,
                      discount: 0,
                    }),
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
        {lines.length === 0 ? (
          <div
            className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center"
            data-testid="purchase-empty"
          >
            <PackageSearch
              className="size-8 text-muted-foreground/60"
              aria-hidden
            />
            <p className="text-sm font-medium">{t("purchases.emptyTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {canCreateProduct
                ? t("purchases.emptyBody")
                : t("purchases.emptyBodyNoCreate")}
            </p>
          </div>
        ) : null}
      </section>

      {lines.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:p-4">
          <h3 className="text-sm font-semibold">
            {t("purchases.paymentTitle")}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>
                {t("purchases.discount")} ({f.symbol})
              </span>
              <MoneyField
                value={discount}
                onValue={setDiscount}
                aria-label={t("purchases.discount")}
                aria-invalid={discountTooBig}
              />
              {discountTooBig ? (
                <span
                  className="text-destructive"
                  role="alert"
                  data-testid="discount-too-big"
                >
                  {t("purchases.discountTooBig", {
                    value: f.money(totals.subtotal),
                  })}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>
                {t("purchases.paid")} ({f.symbol})
              </span>
              <MoneyField
                value={paid}
                onValue={setPaid}
                placeholder={String(totals.total / 100)}
                aria-label={t("purchases.paid")}
                data-testid="purchase-paid"
              />
            </div>
          </div>
          {supplier.id && extra > 0 ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-2 text-sm"
              data-testid="keep-extra"
            >
              <Checkbox
                id="keep-extra"
                checked={keepExtra}
                onCheckedChange={(v) => setKeepExtra(v === true)}
                data-testid="keep-extra-check"
              />
              <label htmlFor="keep-extra" className="min-w-0 flex-1">
                {t("purchases.keepOnAccount", { value: f.money(extra) })}
                <span className="block text-xs text-muted-foreground">
                  {[
                    keepOffDue > 0
                      ? t("purchases.keptOffDue", {
                          value: f.money(keepOffDue),
                        })
                      : "",
                    keepAdvance > 0
                      ? t("purchases.keptAdvance", {
                          value: f.money(keepAdvance),
                        })
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </label>
            </div>
          ) : null}
          <Select
            value={method}
            onValueChange={(v) => setMethod(v as PaymentMethod)}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t("purchases.method")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {methods.pickable(method).map((m) => (
                <SelectItem key={m.code} value={m.code}>
                  {methods.name(m.code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox
              id="update-costs"
              checked={updateCosts}
              onCheckedChange={(v) => setUpdateCosts(v === true)}
            />
            <label htmlFor="update-costs" className="text-sm">
              {t("purchases.updateCosts")}
            </label>
          </div>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("purchases.notes")}
            aria-label={t("purchases.notes")}
            maxLength={300}
          />

          <dl className="space-y-0.5 text-sm">
            <Row label={t("purchases.subtotal")}>
              {f.money(totals.subtotal)}
            </Row>
            {totals.discount > 0 ? (
              <Row label={t("purchases.discount")}>
                −{f.money(totals.discount)}
              </Row>
            ) : null}
            <div className="flex items-center justify-between text-lg font-semibold">
              <dt>{t("purchases.total")}</dt>
              <dd data-testid="purchase-total">{f.money(totals.total)}</dd>
            </div>
            {totals.due > 0 ? (
              <Row label={t("purchases.due")} strong testId="purchase-due">
                {f.money(totals.due)}
              </Row>
            ) : null}
          </dl>
          {needsSupplier ? (
            <p className="text-xs text-destructive">
              {t("purchases.supplierForDue")}
            </p>
          ) : null}
          {costMissing ? (
            <p
              className="text-xs text-destructive"
              role="alert"
              data-testid="cost-missing"
            >
              {t("purchases.costRequired")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => router.back()}>
          {t("common.cancel")}
        </Button>
        <Button
          disabled={!canSave}
          onClick={() => void save()}
          data-testid="save-purchase"
        >
          {t("purchases.save")}
        </Button>
      </div>

      <QuickProductDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        initial={quickText}
        onCreated={addProduct}
      />

      <PartyPicker
        kind="supplier"
        open={supplierOpen}
        onOpenChange={setSupplierOpen}
        selectedId={supplier.id}
        onSelect={(id, label) => setSupplier({ id, name: label })}
        noneLabel={t("purchases.noSupplier")}
      />
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
