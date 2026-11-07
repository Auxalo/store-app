"use client";

import { ArrowLeft, Lock, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { usePaymentMethods, useSaveMethod } from "@/hooks/use-payment-methods";
import { newId } from "@/lib/ids";
import type { MethodDef } from "@/lib/payment-methods";
import { normalizeSearch } from "@/lib/search";

/**
 * The shop's payment methods: cash, bank and card are always there; bKash, Nagad and Rocket can be
 * switched off; the shop can add its own (a local wallet, another bank app).
 */
export function PaymentsCustomizeScreen() {
  const t = useTranslations("customize.payments");
  const tn = useTranslations("common");
  const tp = useTranslations("products");
  const { role } = useProfile();
  const methods = usePaymentMethods();
  const save = useSaveMethod();
  const [editing, setEditing] = useState<MethodDef | "new" | null>(null);

  if (!can(role, "product.edit")) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {tp("noAccess")}
      </p>
    );
  }

  const fixed = methods.all.filter((m) => m.fixed);
  const wallets = methods.all.filter((m) => m.builtin && !m.fixed);
  const own = methods.all.filter((m) => !m.builtin && !m.removed);
  const removedOwn = methods.all.filter((m) => !m.builtin && m.removed);

  async function setRemoved(method: MethodDef, removed: boolean) {
    try {
      await save({ code: method.code, name: method.customName, removed });
    } catch {
      toast.error(tn("somethingWrong"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link
        href="/customize"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {tn("back")}
      </Link>
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("fixedTitle")}
        </h3>
        <ul className="flex flex-col gap-2" data-testid="method-fixed">
          {fixed.map((m) => (
            <li
              key={m.code}
              className="flex items-center gap-3 rounded-xl border bg-card p-3"
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {methods.name(m.code)}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden />
                {t("alwaysOn")}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t("walletsTitle")}
        </h3>
        <ul className="flex flex-col gap-2" data-testid="method-wallets">
          {wallets.map((m) => (
            <li
              key={m.code}
              className="flex items-center gap-3 rounded-xl border bg-card p-3"
              data-testid={`method-row-${m.code}`}
            >
              <span className="min-w-0 flex-1 truncate font-medium">
                {methods.name(m.code)}
              </span>
              <Switch
                checked={!m.removed}
                onCheckedChange={(on) => void setRemoved(m, !on)}
                aria-label={`${methods.name(m.code)}: ${t("useIt")}`}
                data-testid={`method-switch-${m.code}`}
              />
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("walletsHint")}</p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("ownTitle")}
          </h3>
          <Button
            size="sm"
            onClick={() => setEditing("new")}
            data-testid="method-add"
          >
            <Plus aria-hidden />
            {t("add")}
          </Button>
        </div>
        {own.length === 0 ? (
          <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
            {t("ownEmpty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="method-own">
            {own.map((m) => (
              <li
                key={m.code}
                className="flex items-center gap-2 rounded-xl border bg-card p-3"
                data-testid="method-own-row"
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {methods.name(m.code)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("edit")}: ${methods.name(m.code)}`}
                  onClick={() => setEditing(m)}
                  data-testid="method-edit"
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("remove")}: ${methods.name(m.code)}`}
                  onClick={() => void setRemoved(m, true)}
                  data-testid="method-remove"
                >
                  <Trash2 className="text-destructive" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {removedOwn.length > 0 ? (
          <details
            className="rounded-xl border p-3"
            data-testid="method-removed"
          >
            <summary className="cursor-pointer text-sm font-medium">
              {t("removedTitle")} ({removedOwn.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {removedOwn.map((m) => (
                <li key={m.code} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {methods.name(m.code)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void setRemoved(m, false)}
                    data-testid="method-restore"
                  >
                    <Undo2 aria-hidden />
                    {t("restore")}
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <MethodDialog
        method={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}

/** Add one of the shop's own methods (`method` is null) or rename one. */
function MethodDialog({
  method,
  open,
  onOpenChange,
}: {
  method: MethodDef | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("customize.payments");
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={method ? t("dialogEdit") : t("dialogAdd")}
    >
      {open ? (
        <MethodForm
          key={method?.code ?? "new"}
          method={method}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </ResponsiveDialog>
  );
}

function MethodForm({
  method,
  onDone,
}: {
  method: MethodDef | null;
  onDone: () => void;
}) {
  const t = useTranslations("customize.payments");
  const tc = useTranslations("common");
  const methods = usePaymentMethods();
  const save = useSaveMethod();
  const [name, setName] = useState(method ? methods.name(method.code) : "");
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);

  const clean = name.trim();
  const taken = methods.active.some(
    (m) =>
      m.code !== method?.code &&
      normalizeSearch(methods.name(m.code)) === normalizeSearch(clean),
  );
  const problem = clean === "" ? "nameRequired" : taken ? "nameTaken" : null;

  async function submit() {
    if (problem) return setShowError(true);
    setSaving(true);
    try {
      await save({
        code: method?.code ?? `m_${newId().replace(/-/g, "")}`,
        name: clean,
        removed: false,
      });
      toast.success(t("saved"));
      onDone();
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
        <FieldLabel htmlFor="method-name">{t("name")}</FieldLabel>
        <Input
          id="method-name"
          value={name}
          maxLength={40}
          autoFocus
          placeholder={t("namePlaceholder")}
          aria-invalid={showError && !!problem}
          onChange={(e) => setName(e.target.value)}
          data-testid="method-name"
        />
        {showError && problem ? (
          <p className="text-sm text-destructive" role="alert">
            {t(problem)}
          </p>
        ) : null}
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone}>
          {tc("cancel")}
        </Button>
        <Button type="submit" disabled={saving} data-testid="method-save">
          {tc("save")}
        </Button>
      </div>
    </form>
  );
}
