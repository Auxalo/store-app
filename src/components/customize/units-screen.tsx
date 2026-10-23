"use client";

import { ArrowLeft, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useList } from "@/data/hooks";
import { useSaveUnit, useUnits } from "@/hooks/use-units";
import type { UnitDef } from "@/lib/units";
import { UnitDialog } from "./unit-dialog";

/** The shop's units: every one can be renamed or removed, and new ones added. */
export function UnitsScreen() {
  const t = useTranslations("customize.units");
  const tn = useTranslations("common");
  const tp = useTranslations("products");
  const { role } = useProfile();
  const units = useUnits();
  const save = useSaveUnit();
  const [editing, setEditing] = useState<UnitDef | "new" | null>(null);
  const [removing, setRemoving] = useState<UnitDef | null>(null);

  if (!can(role, "product.edit")) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {tp("noAccess")}
      </p>
    );
  }

  const removed = units.all.filter((u) => u.removed);

  async function restore(unit: UnitDef) {
    try {
      await save({
        code: unit.code,
        name: unit.customName,
        decimals: unit.decimals,
        removed: false,
      });
    } catch {
      toast.error(tn("somethingWrong"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <Link
        href="/customize"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {tn("back")}
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("intro")}</p>
        </div>
        <Button
          className="shrink-0"
          onClick={() => setEditing("new")}
          data-testid="unit-add"
        >
          <Plus aria-hidden />
          {t("add")}
        </Button>
      </div>

      <ul className="flex flex-col gap-2" data-testid="unit-list">
        {units.active.map((u) => (
          <li
            key={u.code}
            className="flex items-center gap-2 rounded-xl border bg-card p-3"
            data-testid="unit-row"
          >
            <p className="min-w-0 flex-1 truncate font-medium">
              {units.name(u.code)}
            </p>
            <Badge variant="secondary" className="shrink-0">
              {u.decimals > 0 ? t("loose") : t("whole")}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t("edit")}: ${units.name(u.code)}`}
              onClick={() => setEditing(u)}
              data-testid="unit-edit"
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t("remove")}: ${units.name(u.code)}`}
              onClick={() => setRemoving(u)}
              data-testid="unit-remove"
            >
              <Trash2 className="text-destructive" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      {removed.length > 0 ? (
        <details className="rounded-xl border p-3" data-testid="unit-removed">
          <summary className="cursor-pointer text-sm font-medium">
            {t("removedTitle")} ({removed.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {removed.map((u) => (
              <li
                key={u.code}
                className="flex items-center gap-3"
                data-testid="unit-removed-row"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {units.name(u.code)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void restore(u)}
                  data-testid="unit-restore"
                >
                  <Undo2 aria-hidden />
                  {t("restore")}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <UnitDialog
        unit={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
      <RemoveUnitDialog unit={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}

/**
 * Removing a unit hides it from every picker; old records keep its name. A unit a product still
 * uses cannot go: the dialog lists those products so they can be changed first.
 */
function RemoveUnitDialog({
  unit,
  onClose,
}: {
  unit: UnitDef | null;
  onClose: () => void;
}) {
  const t = useTranslations("customize.units");
  const tn = useTranslations("common");
  const units = useUnits();
  const save = useSaveUnit();
  const [saving, setSaving] = useState(false);
  const using = useList(
    "products",
    { unit: unit?.code, active: "all" },
    { pageSize: 6, enabled: !!unit },
  );
  const inUse = using.items.length > 0;
  const name = unit ? units.name(unit.code) : "";

  async function confirm() {
    if (!unit || inUse) return;
    setSaving(true);
    try {
      await save({
        code: unit.code,
        name: unit.customName,
        decimals: unit.decimals,
        removed: true,
      });
      onClose();
    } catch {
      toast.error(tn("somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveDialog
      open={unit !== null}
      onOpenChange={(open) => !open && onClose()}
      title={inUse ? t("inUseTitle") : t("removeTitle", { name })}
    >
      {unit ? (
        <div className="flex flex-col gap-3" data-testid="unit-remove-dialog">
          {using.status === "loading" ? null : inUse ? (
            <>
              <p className="text-sm">{t("inUseBody")}</p>
              <ul
                className="list-disc space-y-1 ps-5 text-sm"
                data-testid="unit-in-use"
              >
                {using.items.slice(0, 5).map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/products/edit?id=${p.id}`}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {p.name}
                    </Link>
                  </li>
                ))}
                {using.items.length > 5 || using.hasMore ? (
                  <li className="list-none text-muted-foreground">
                    {t("inUseMore")}
                  </li>
                ) : null}
              </ul>
            </>
          ) : (
            <p className="text-sm">{t("removeBody")}</p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose}>
              {inUse ? tn("close") : tn("cancel")}
            </Button>
            {inUse ? null : (
              <Button
                variant="destructive"
                disabled={saving || using.status !== "ready"}
                onClick={() => void confirm()}
                data-testid="unit-remove-confirm"
              >
                {t("removeConfirm")}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </ResponsiveDialog>
  );
}
