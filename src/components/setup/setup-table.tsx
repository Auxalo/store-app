"use client";

import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { ClipboardPaste, Copy, Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCategories, useCommand } from "@/data/hooks";
import { useDataMode } from "@/data/mode-store";
import { fetchPage } from "@/data/online";
import { parseListParams } from "@/data/spec";
import { getLocalDb } from "@/db/local/db";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { normalizePhone } from "@/lib/phone";
import { normalizeSearch } from "@/lib/search";
import { UNIT_CODES } from "@/lib/units";
import {
  type CheckedRow,
  COLUMNS,
  checkRows,
  emptyExisting,
  MAX_SETUP_ROWS,
  makeUnitLookup,
  type PartyValue,
  type ProductValue,
  planCategories,
  productKey,
  rowsFromPaste,
  type SetupKind,
  templateText,
} from "@/setup/rows";

type Doc = Record<string, unknown>;

async function localDocs(kind: SetupKind): Promise<Doc[]> {
  const db = getLocalDb();
  const table =
    kind === "products"
      ? db.products
      : kind === "customers"
        ? db.customers
        : db.suppliers;
  return (await table
    .filter((x) => !x.deletedAt)
    .toArray()) as unknown as Doc[];
}

/** Everything of this kind on the server (setup runs once, so a few pages at most). */
async function serverDocs(kind: SetupKind): Promise<Doc[]> {
  const params = parseListParams(
    kind,
    kind === "products" ? { active: "all" } : {},
  );
  const docs: Doc[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const result = await fetchPage(kind, params, cursor, 200);
    docs.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return docs;
}

function existingFrom(kind: SetupKind, docs: Doc[]) {
  const e = emptyExisting();
  for (const d of docs) {
    if (kind === "products") {
      const p = d as {
        sku?: string;
        barcode?: string;
        name: string;
        unit: never;
        sellingPrice: number;
      };
      if (p.sku) e.skus.add(p.sku);
      if (p.barcode) e.barcodes.add(p.barcode);
      e.productKeys.add(productKey(p.name, p.unit, p.sellingPrice));
    } else {
      const p = d as { phone?: string; name: string };
      if (p.phone) e.phones.add(normalizePhone(p.phone));
      e.names.add(normalizeSearch(p.name));
    }
  }
  return e;
}

/** One line of the list: its cells (one per column, as typed) and an id so React can track it. */
export interface SetupRow {
  id: string;
  cells: string[];
}

interface SetupTableProps {
  kind: SetupKind;
  rows: SetupRow[];
  onRows: (rows: SetupRow[]) => void;
  /** Called after rows were saved, with how many. */
  onSaved: (count: number) => void;
}

const blankRow = (kind: SetupKind): SetupRow => ({
  id: newId(),
  cells: COLUMNS[kind].map(() => ""),
});
const isEmpty = (cells: string[]) => cells.every((c) => c.trim() === "");

/**
 * An editable list for one setup step. People type rows or paste them from a spreadsheet; every row
 * is checked as they go, and only when none has a problem can the list be saved. Saving uses the
 * app's normal commands, so everything syncs like anything else entered in the app.
 */
export function SetupTable({ kind, rows, onRows, onSaved }: SetupTableProps) {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommand();
  const mode = useDataMode();
  const categoryList = useCategories();
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const columns = COLUMNS[kind];
  const label = (key: string) => {
    if (key === "balance")
      return t(
        kind === "customers"
          ? "setup.balanceCustomer"
          : "setup.balanceSupplier",
      );
    if (key === "stock") return t("products.openingStock");
    if (key === "lowStock") return t("products.lowStockThreshold");
    return t(`${kind === "products" ? "products" : kind}.${key}` as never);
  };

  // What the shop already has, so a row that repeats it is caught before saving. On the device it
  // is all there; online it is read from the server a page at a time.
  const local = useLiveQuery(
    async () =>
      mode === "offline"
        ? existingFrom(kind, await localDocs(kind))
        : undefined,
    [kind, mode],
  );
  const online = useQuery({
    // Not under "data": every saved row refreshes those, and this one is read once.
    queryKey: ["setup-existing", kind],
    enabled: mode === "online",
    staleTime: 0,
    queryFn: async () => existingFrom(kind, await serverDocs(kind)),
  });
  const existing = mode === "online" ? online.data : local;

  const unitOf = useMemo(
    () =>
      makeUnitLookup(
        Object.fromEntries(UNIT_CODES.map((u) => [u, t(`units.${u}`)])),
      ),
    [t],
  );

  const checked: CheckedRow[] = useMemo(
    () =>
      checkRows(
        kind,
        rows.map((r) => r.cells),
        { existing: existing ?? emptyExisting(), unitOf },
      ),
    [kind, rows, existing, unitOf],
  );
  const filled = rows
    .map((r, i) => ({ id: r.id, cells: r.cells, row: checked[i] }))
    .filter((r) => !isEmpty(r.cells));
  const problems = filled.filter((r) => Object.keys(r.row.issues).length > 0);
  const saving = progress !== null;
  const canSave =
    existing !== undefined &&
    filled.length > 0 &&
    problems.length === 0 &&
    !saving;

  const setCell = (id: string, col: number, value: string) =>
    onRows(
      rows.map((r) =>
        r.id === id
          ? { ...r, cells: r.cells.map((c, j) => (j === col ? value : c)) }
          : r,
      ),
    );

  function addPasted() {
    const parsed = rowsFromPaste(kind, pasteText);
    const base = rows.filter((r) => !isEmpty(r.cells));
    const room = MAX_SETUP_ROWS - base.length;
    const pad = (cells: string[]): SetupRow => ({
      id: newId(),
      cells: columns.map((_, i) => cells[i] ?? ""),
    });
    onRows([...base, ...parsed.slice(0, Math.max(0, room)).map(pad)]);
    if (parsed.length > room)
      toast.message(t("setup.tooMany", { n: f.integer(MAX_SETUP_ROWS) }));
    setPasteText("");
    setPasting(false);
  }

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(
        templateText(columns.map((c) => label(c.key))),
      );
      toast.success(t("setup.templateCopied"));
    } catch {
      toast.error(t("common.somethingWrong"));
    }
  }

  async function save() {
    const items = filled
      .map((r) => r.row.value)
      .filter((v): v is NonNullable<typeof v> => !!v);
    setProgress({ done: 0, total: items.length });
    let done = 0;
    try {
      if (kind === "products") {
        const products = items as ProductValue[];
        const plan = planCategories(
          products.map((p) => p.category),
          categoryList ?? [],
          newId,
        );
        for (const c of plan.toCreate)
          await run("category.create", {
            id: c.id,
            name: c.name,
            nameBn: "",
            description: "",
          });
        for (const p of products) {
          await run("product.create", {
            id: newId(),
            name: p.name,
            nameBn: p.nameBn,
            categoryId: p.category
              ? (plan.idFor.get(normalizeSearch(p.category)) ?? null)
              : null,
            unit: p.unit,
            sku: p.sku,
            barcode: p.barcode,
            purchasePrice: p.purchasePrice,
            sellingPrice: p.sellingPrice,
            lowStockThreshold: p.lowStockThreshold,
            openingStock: p.openingStock,
            openingMovementId: newId(),
          });
          setProgress({ done: ++done, total: items.length });
          if (done % 25 === 0) await new Promise((r) => setTimeout(r));
        }
      } else {
        const partyType = kind === "customers" ? "customer" : "supplier";
        for (const p of items as PartyValue[]) {
          const id = newId();
          await run(
            `${partyType}.create` as never,
            { id, name: p.name, phone: p.phone, address: p.address } as never,
          );
          if (p.balance !== 0)
            await run("party.openingBalance", {
              id: newId(),
              partyType,
              partyId: id,
              amount: p.balance,
              note: t("setup.openingNote"),
            });
          setProgress({ done: ++done, total: items.length });
          if (done % 25 === 0) await new Promise((r) => setTimeout(r));
        }
      }
      onRows([]);
      onSaved(done);
      toast.success(t("setup.saved", { count: done, n: f.integer(done) }));
    } catch {
      // Rows already saved are in the shop now; keep only the ones that were not.
      onRows(filled.slice(done).map((r) => ({ id: r.id, cells: r.cells })));
      if (done > 0) onSaved(done);
      toast.error(t("setup.saveFailed", { n: f.integer(done) }));
    } finally {
      if (mode === "online") void online.refetch();
      setProgress(null);
    }
  }

  const gridStyle = {
    gridTemplateColumns: `repeat(${columns.length}, minmax(7.5rem, 1fr))`,
  };

  return (
    <div className="flex flex-col gap-3" data-testid={`setup-${kind}`}>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPasting(true)}
          disabled={saving}
          data-testid="setup-paste"
        >
          <ClipboardPaste aria-hidden />
          {t("setup.paste")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRows([...rows, blankRow(kind)])}
          disabled={saving || rows.length >= MAX_SETUP_ROWS}
          data-testid="setup-add-row"
        >
          <Plus aria-hidden />
          {t("setup.addRow")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void copyTemplate()}
        >
          <Copy aria-hidden />
          {t("setup.copyTemplate")}
        </Button>
        {rows.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRows([])}
            disabled={saving}
          >
            <Trash2 aria-hidden />
            {t("setup.clear")}
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("setup.emptyTable")}
        </p>
      ) : (
        <div className="overflow-x-auto" data-testid="setup-rows">
          <div className="grid min-w-max gap-2 max-md:min-w-0">
            <div
              className="hidden gap-2 text-xs font-medium text-muted-foreground md:grid"
              style={gridStyle}
            >
              {columns.map((c) => (
                <span key={c.key}>
                  {label(c.key)}
                  {c.required ? (
                    <span className="text-destructive"> *</span>
                  ) : null}
                </span>
              ))}
            </div>
            {rows.map((row, i) => {
              const cells = row.cells;
              const issues = checked[i]?.issues ?? {};
              const bad = Object.keys(issues);
              return (
                <div
                  key={row.id}
                  className="rounded-xl border p-2 md:border-0 md:p-0"
                  data-testid="setup-row"
                >
                  <div
                    className="grid grid-cols-2 gap-2 md:[grid-template-columns:var(--cols)]"
                    style={
                      {
                        "--cols": gridStyle.gridTemplateColumns,
                      } as React.CSSProperties
                    }
                  >
                    {columns.map((c, j) => (
                      <div
                        key={c.key}
                        className="flex flex-col gap-1 text-xs text-muted-foreground md:contents"
                      >
                        <span aria-hidden className="md:hidden">
                          {label(c.key)}
                        </span>
                        <Input
                          value={cells[j] ?? ""}
                          onChange={(e) => setCell(row.id, j, e.target.value)}
                          aria-label={`${label(c.key)} ${f.integer(i + 1)}`}
                          aria-invalid={!!issues[c.key]}
                          disabled={saving}
                          inputMode={
                            [
                              "purchasePrice",
                              "sellingPrice",
                              "stock",
                              "lowStock",
                              "balance",
                              "barcode",
                            ].includes(c.key)
                              ? "decimal"
                              : c.key === "phone"
                                ? "tel"
                                : undefined
                          }
                          className="h-9"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <p
                      className="text-xs text-destructive"
                      role={
                        bad.length > 0 && !isEmpty(cells) ? "alert" : undefined
                      }
                      data-testid={
                        bad.length > 0 && !isEmpty(cells)
                          ? "setup-row-problem"
                          : undefined
                      }
                    >
                      {isEmpty(cells)
                        ? null
                        : bad
                            .map(
                              (k) =>
                                `${label(k)} ${t(`setup.issue.${issues[k]}` as never)}`,
                            )
                            .join(" · ")}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={t("common.delete")}
                      onClick={() =>
                        onRows(rows.filter((r) => r.id !== row.id))
                      }
                      disabled={saving}
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          className="text-sm text-muted-foreground"
          data-testid="setup-summary"
        >
          {t("setup.rowCount", {
            count: filled.length,
            n: f.integer(filled.length),
          })}
          {problems.length > 0
            ? ` · ${t("setup.problemCount", { count: problems.length, n: f.integer(problems.length) })}`
            : ""}
        </p>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          data-testid="setup-save"
        >
          {saving
            ? t("setup.saving", {
                done: f.integer(progress?.done ?? 0),
                total: f.integer(progress?.total ?? 0),
              })
            : t("setup.save", {
                count: filled.length,
                n: f.integer(filled.length),
              })}
        </Button>
      </div>
      {saving ? (
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress?.total}
          aria-valuenow={progress?.done}
        >
          <div
            className="h-full bg-primary transition-all"
            style={{
              width: `${progress?.total ? (progress.done / progress.total) * 100 : 0}%`,
            }}
          />
        </div>
      ) : null}

      <ResponsiveDialog
        open={pasting}
        onOpenChange={setPasting}
        title={t("setup.pasteTitle")}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t("setup.pasteHelp", {
              columns: columns.map((c) => label(c.key)).join(", "),
            })}
          </p>
          <Textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={8}
            autoFocus
            data-testid="setup-paste-text"
            aria-label={t("setup.pasteTitle")}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPasting(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={addPasted}
              disabled={pasteText.trim() === ""}
              data-testid="setup-paste-add"
            >
              {t("setup.pasteAdd")}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </div>
  );
}
