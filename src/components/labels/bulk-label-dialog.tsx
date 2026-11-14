"use client";

import {
  Loader2,
  Printer,
  ScanBarcode,
  Search,
  TriangleAlert,
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
import { useCreateBarcode, usePrintLabels } from "@/hooks/use-labels";
import { useFormat } from "@/i18n/use-format";
import { barcodeProblem, clampSize } from "@/lib/labels/label-layout";
import { MAX_LABELS_PER_PRINT } from "@/lib/print/print-window";
import { printSupport } from "@/lib/print/transports";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/stores/preferences";
import {
  CopiesStepper,
  LabelPriceSwitch,
  LabelSizePicker,
} from "./label-controls";
import { LabelPreview, useProblemText } from "./label-preview";

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
 * ticked until they have one (one tap makes it).
 */
export function BulkLabelDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("labels");
  const f = useFormat();
  const { role } = useProfile();
  const size = clampSize(usePreferences((s) => s.labelSize));
  const showPrice = usePreferences((s) => s.labelShowPrice);
  const canEdit = can(role, "product.edit");
  const createBarcode = useCreateBarcode();
  const { print, busy } = usePrintLabels();
  const problemText = useProblemText();

  const [search, setSearch] = useState("");
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
    { q, active: "active", sort: "name" },
    { pageSize: 50, enabled: open },
  );
  const items = list.items as Product[];

  const total = useMemo(
    () => [...picked.values()].reduce((sum, p) => sum + p.copies, 0),
    [picked],
  );
  const overLimit = total > MAX_LABELS_PER_PRINT;
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

  async function go() {
    const result = await print(
      [...picked.values()].map(({ product, copies }) => ({
        product: live(product.id, product),
        copies,
      })),
    );
    if (result.ok) toast.success(t("sent"));
    else
      toast.error(
        result.problem
          ? `${result.name}: ${problemText(result.problem, size)}`
          : t("failed"),
      );
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
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {p.barcode}
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
              size={size}
            />
          ) : (
            <div className="flex min-h-24 items-center justify-center rounded-xl bg-muted/60 p-4 text-center text-sm text-muted-foreground">
              {t("nothingSelected")}
            </div>
          )}
          <LabelSizePicker />
          <LabelPriceSwitch />
        </div>
      </div>

      {windows ? (
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
              {t("limit", { n: MAX_LABELS_PER_PRINT })}
            </p>
          ) : null}
        </div>
        <Button
          size="lg"
          disabled={picked.size === 0 || overLimit || busy}
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
      </div>
    </ResponsiveDialog>
  );
}
