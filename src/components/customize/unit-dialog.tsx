"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSaveUnit, useUnits } from "@/hooks/use-units";
import { newId } from "@/lib/ids";
import { normalizeSearch } from "@/lib/search";
import type { UnitDef } from "@/lib/units";

/** Add a unit (`unit` is null) or change one: its name and whether fractions are allowed. */
export function UnitDialog({
  unit,
  open,
  onOpenChange,
  onSaved,
}: {
  unit: UnitDef | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the unit code once saved (the product form selects it). */
  onSaved?: (code: string) => void;
}) {
  const t = useTranslations("customize.units");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={unit ? t("dialogEdit") : t("dialogAdd")}
    >
      {open ? (
        <UnitForm
          key={unit?.code ?? "new"}
          unit={unit}
          onDone={(code) => {
            onOpenChange(false);
            onSaved?.(code);
          }}
          onCancel={() => onOpenChange(false)}
        />
      ) : null}
    </ResponsiveDialog>
  );
}

function UnitForm({
  unit,
  onDone,
  onCancel,
}: {
  unit: UnitDef | null;
  onDone: (code: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("customize.units");
  const tc = useTranslations("common");
  const units = useUnits();
  const save = useSaveUnit();
  const startName = unit ? units.name(unit.code) : "";
  const [name, setName] = useState(startName);
  const [loose, setLoose] = useState(unit ? unit.decimals > 0 : false);
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);

  const clean = name.trim();
  const taken = units.active.some(
    (u) =>
      u.code !== unit?.code &&
      normalizeSearch(units.name(u.code)) === normalizeSearch(clean),
  );
  const problem = clean === "" ? "nameRequired" : taken ? "nameTaken" : null;

  async function submit() {
    if (problem) return setShowError(true);
    setSaving(true);
    try {
      const code = unit?.code ?? `u_${newId().replace(/-/g, "")}`;
      // A built-in unit whose name was left alone keeps its translated default name.
      const keepDefault =
        !!unit?.builtin && !unit.customName && clean === startName;
      await save({
        code,
        name: keepDefault ? "" : clean,
        decimals: loose ? (unit && unit.decimals > 0 ? unit.decimals : 3) : 0,
        removed: false,
      });
      toast.success(t("saved"));
      onDone(code);
    } catch {
      toast.error(tc("somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field data-invalid={showError && !!problem}>
        <FieldLabel htmlFor="unit-name">{t("name")}</FieldLabel>
        <Input
          id="unit-name"
          value={name}
          maxLength={40}
          autoFocus
          placeholder={t("namePlaceholder")}
          aria-invalid={showError && !!problem}
          onChange={(e) => setName(e.target.value)}
          data-testid="unit-name"
        />
        {showError && problem ? (
          <p className="text-sm text-destructive" role="alert">
            {t(problem)}
          </p>
        ) : null}
      </Field>

      <div className="flex items-start gap-3 rounded-lg border p-3">
        <Checkbox
          id="unit-loose"
          checked={loose}
          onCheckedChange={(v) => setLoose(v === true)}
          data-testid="unit-loose"
        />
        <div className="min-w-0">
          <label htmlFor="unit-loose" className="text-sm font-medium">
            {t("loosePrompt")}
          </label>
          <FieldDescription>{t("looseHint")}</FieldDescription>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={saving} data-testid="unit-save">
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}
