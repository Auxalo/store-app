"use client";

import {
  Download,
  Loader2,
  Printer,
  ScanBarcode,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useList } from "@/data/hooks";
import type { Product } from "@/db/local/types";
import {
  maxLabels,
  useCreateBarcode,
  useLabelShop,
  usePrintLabels,
} from "@/hooks/use-labels";
import { useFormat } from "@/i18n/use-format";
import { isPriceCode } from "@/lib/labels/barcode";
import { barcodeProblem, clampSize } from "@/lib/labels/label-layout";
import { fitsRoll, isRoll, rollPrintableMm } from "@/lib/labels/label-sheet";
import { printSupport } from "@/lib/print/transports";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";
import {
  CopiesStepper,
  LabelPaperPicker,
  LabelPriceSwitch,
  LabelShopSwitch,
  LabelSizePicker,
} from "./label-controls";
import { LabelPreview, useProblemText } from "./label-preview";
import { ReplaceCodeButton } from "./replace-code";

interface Picked {
  product: Product;
  copies: number;
}

/** Can this product's code be printed as a barcode on this label size? Anything but "ok" is red. */
function codeState(
  code: string,
  size: { w: number; h: number },
): "ok" | "none" | "bad" | "wide" {
  const problem = barcodeProblem(code, size);
  if (!problem) return "ok";
  if (problem === "EMPTY") return "none";
  return problem === "TOO_WIDE" ? "wide" : "bad";
}

/**
 * "Print labels" for many products from the Products page: search, tick the products, set how
 * many labels each, and print them all in one go. Products with no barcode are red and cannot be
 * ticked until they have one (one tap makes it). When the Products page is showing one category,
 * the list starts on that category; its chip takes the limit off.
 */
export function BulkLabelDialog({
  open,
  onOpenChange,
  category = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The category the Products page is filtered to, if any. */
  category?: { id: string; name: string } | null;
}) {
  const t = useTranslations("labels");
  const tp = useTranslations("printer");
  const f = useFormat();
  const { role } = useProfile();
  const size = clampSize(usePreferences((s) => s.labelSize));
  const showPrice = usePreferences((s) => s.labelShowPrice);
  const shop = useLabelShop();
  const canEdit = can(role, "product.edit");
  const createBarcode = useCreateBarcode();
  const { print, download, busy, paper } = usePrintLabels();
  const problemText = useProblemText();

  const [search, setSearch] = useState("");
  const [only, setOnly] = useState(category);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Map<string, Picked>>(new Map());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [windows, setWindows] = useState(false);
  useEffect(() => setWindows(printSupport().windows), []);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 200);
    return () => clearTimeout(id);
  }, [search]);

  const list = useList(
    "products",
    { q, categoryId: only?.id, active: "active", sort: "name" },
    { pageSize: 50, enabled: open },
  );
  const items = list.items as Product[];

  const total = useMemo(
    () => [...picked.values()].reduce((sum, p) => sum + p.copies, 0),
    [picked],
  );
  // On a receipt roll the label must fit the roll, and one print is at most a few metres of paper.
  const roll = isRoll(paper);
  const wide = isRoll(paper) && !fitsRoll(size, paper);
  const most = maxLabels(paper);
  const overLimit = total > most;
  const ready = items.filter((p) => codeState(p.barcode, size) === "ok");
  const allShownPicked =
    ready.length > 0 && ready.every((p) => picked.has(p.id));

  // A pick follows its product when the product changes (for example it was given a barcode).
  const live = (id: string, fallback: Product) =>
    items.find((p) => p.id === id) ?? fallback;

  function toggle(product: Product, on: boolean) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (on) next.set(product.id, { product, copies: 1 });
      else next.delete(product.id);
      return next;
    });
    if (on) setFocusId(product.id);
  }

  function setCopies(id: string, copies: number) {
    setPicked((prev) => {
      const entry = prev.get(id);
      if (!entry) return prev;
      return new Map(prev).set(id, { ...entry, copies });
    });
  }

  function toggleAllShown() {
    setPicked((prev) => {
      const next = new Map(prev);
      if (allShownPicked) for (const p of ready) next.delete(p.id);
      else
        for (const p of ready)
          if (!next.has(p.id)) next.set(p.id, { product: p, copies: 1 });
      return next;
    });
  }

  async function make(product: Product) {
    setCreating(product.id);
    try {
      await createBarcode(product);
      toast.success(t("created"));
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setCreating(null);
    }
  }

  async function go(save = false) {
    const result = await (save ? download : print)(
      [...picked.values()].map(({ product, copies }) => ({
        product: live(product.id, product),
        copies,
      })),
    );
    if (result.ok)
      toast.success(
        t(
          result.to === "printer"
            ? "sentPrinter"
            : result.to === "file"
              ? "downloaded"
              : "sent",
        ),
      );
    else if (result.problem)
      toast.error(`${result.name}: ${problemText(result.problem, size)}`);
    else if (result.wide && isRoll(paper))
      toast.error(
        t("paperTooWide", { w: size.w, max: rollPrintableMm(paper) }),
      );
    else if (result.printer) toast.error(tp(`fail_${result.printer}` as never));
    else toast.error(t("failed"));
  }

  const focus = focusId ? picked.get(focusId) : [...picked.values()].at(-1);
  const focusProduct = focus ? live(focus.product.id, focus.product) : null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("bulkTitle")}
      wide
    >
      <div
        className="grid gap-4 md:grid-cols-[1fr_15rem]"
        data-testid="bulk-labels"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("bulkSearch")}
              aria-label={t("bulkSearch")}
              className="ps-9"
              data-testid="bulk-search"
            />
          </div>

          {only ? (
            <Button
              type="button"
              variant="outline"
              className="h-auto self-start rounded-full border-primary bg-primary/10 px-3 py-1 text-sm text-primary hover:bg-primary/15"
              onClick={() => setOnly(null)}
              title={t("showAll")}
              data-testid="bulk-category"
            >
              {only.name}
              <X aria-hidden />
              <span className="sr-only">{t("showAll")}</span>
            </Button>
          ) : null}

          <div className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Checkbox
                id="bulk-select-all"
                checked={allShownPicked}
                disabled={ready.length === 0}
                onCheckedChange={toggleAllShown}
                data-testid="bulk-select-all"
              />
              <label htmlFor="bulk-select-all">{t("selectAll")}</label>
            </div>
            {picked.size > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPicked(new Map())}
              >
                {t("clearAll")}
              </Button>
            ) : null}
          </div>

          <ul
            className="flex max-h-[42dvh] flex-col gap-2 overflow-y-auto pe-1"
            data-testid="bulk-list"
          >
            {items.map((p) => {
              const state = codeState(p.barcode, size);
              const entry = picked.get(p.id);
              return (
                <li
                  key={p.id}
                  data-testid="bulk-row"
                  data-state={state}
                  className={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-2.5",
                    state !== "ok" && "border-destructive/40 bg-destructive/5",
                    entry && "border-primary bg-primary/5",
                  )}
                >
                  <Checkbox
                    checked={!!entry}
                    disabled={state !== "ok"}
                    onCheckedChange={(on) => toggle(p, on === true)}
                    aria-label={p.name}
                    data-testid="bulk-check"
                  />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-start"
                    onClick={() => entry && setFocusId(p.id)}
                    disabled={!entry}
                  >
                    <span className="block truncate font-medium">{p.name}</span>
                    {state === "ok" ? (
                      <span className="flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
                        <span className="truncate">{p.barcode}</span>
                        {isPriceCode(p.barcode) ? (
                          <span
                            className="flex shrink-0 items-center gap-0.5 font-sans font-medium text-amber-600"
                            title={t("priceCodeBody")}
                            data-testid="bulk-price-code"
                          >
                            <TriangleAlert className="size-3.5" aria-hidden />
                            {t("priceCodeTitle")}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                        {state === "none" ? (
                          <ScanBarcode className="size-3.5" aria-hidden />
                        ) : (
                          <TriangleAlert className="size-3.5" aria-hidden />
                        )}
                        {state === "none"
                          ? t("noCode")
                          : state === "wide"
                            ? t("tooWide", { w: size.w, h: size.h })
                            : t("badCode")}
                      </span>
                    )}
                  </button>
                  {state === "none" && canEdit ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive"
                      disabled={creating === p.id}
                      onClick={() => void make(p)}
                      data-testid="bulk-create-barcode"
                    >
                      {creating === p.id ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : null}
                      {t("createBarcode")}
                    </Button>
                  ) : null}
                  {state === "ok" && canEdit && isPriceCode(p.barcode) ? (
                    <ReplaceCodeButton product={p} compact />
                  ) : null}
                  {entry ? (
                    <CopiesStepper
                      size="small"
                      value={entry.copies}
                      onChange={(n) => setCopies(p.id, n)}
                      label={t("copiesOf", { name: p.name })}
                    />
                  ) : null}
                </li>
              );
            })}
            {items.length === 0 && list.status !== "loading" ? (
              <li className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t("noResults")}
              </li>
            ) : null}
            {list.hasMore ? (
              <li>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={list.loadMore}
                  disabled={list.isLoadingMore}
                >
                  {t("showMore")}
                </Button>
              </li>
            ) : null}
          </ul>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {focusProduct ? (
            <LabelPreview
              name={focusProduct.name}
              barcode={focusProduct.barcode}
              price={showPrice ? f.money(focusProduct.sellingPrice) : undefined}
              shop={shop}
              size={size}
            />
          ) : (
            <div className="flex min-h-24 items-center justify-center rounded-xl bg-muted/60 p-4 text-center text-sm text-muted-foreground">
              {t("nothingSelected")}
            </div>
          )}
          <LabelPaperPicker total={total} />
          <LabelSizePicker />
          <LabelPriceSwitch />
          <LabelShopSwitch />
        </div>
      </div>

      {windows && !roll ? (
        <p className="rounded-lg bg-amber-500/10 p-2 text-xs">
          {t("windowsNote")}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t pt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium" data-testid="bulk-summary">
            {t("selected", {
              pc: picked.size,
              p: f.integer(picked.size),
              lc: total,
              l: f.integer(total),
            })}
          </p>
          {overLimit ? (
            <p className="text-xs text-destructive">
              {t("limit", { n: most })}
            </p>
          ) : null}
        </div>
        <Button
          size="lg"
          disabled={picked.size === 0 || overLimit || wide || busy}
          onClick={() => void go()}
          data-testid="bulk-print"
        >
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Printer aria-hidden />
          )}
          {busy
            ? t("printing")
            : t("printNow", { count: total, n: f.integer(total) })}
        </Button>
        <Button
          variant="outline"
          disabled={picked.size === 0 || overLimit || wide || busy}
          onClick={() => void go(true)}
          data-testid="bulk-download"
        >
          <Download aria-hidden />
          {t("downloadPdf")}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
