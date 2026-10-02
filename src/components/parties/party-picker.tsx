"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Check, Search, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getLocalDb } from "@/db/local/db";
import { type PartyKind, searchParties } from "@/db/local/queries/customers";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { useCommands } from "@/sync/use-commands";

interface PartyPickerProps {
  kind: PartyKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string | null, name: string) => void;
  /** Label for "nobody" (walk-in customer / no supplier). */
  noneLabel: string;
}

/** Pick a customer or supplier, or add one on the spot. */
export function PartyPicker({
  kind,
  open,
  onOpenChange,
  selectedId,
  onSelect,
  noneLabel,
}: PartyPickerProps) {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommands();
  const ns = kind === "customer" ? "customers" : "suppliers";
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const phoneOk = isValidPhone(phone);
  const [saving, setSaving] = useState(false);

  const parties =
    useLiveQuery(
      () => searchParties(getLocalDb(), kind, deferred),
      [kind, deferred],
    ) ?? [];

  const choose = (id: string | null, label: string) => {
    onSelect(id, label);
    onOpenChange(false);
  };

  async function add() {
    if (!name.trim() || !phoneOk) return;
    setSaving(true);
    try {
      const id = newId();
      await run(
        `${kind}.create` as never,
        { id, name: name.trim(), phone: normalizePhone(phone) } as never,
      );
      const label = name.trim();
      setName("");
      setPhone("");
      setAdding(false);
      choose(id, label);
    } catch {
      toast.error(t("common.somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        kind === "customer"
          ? t("pos.chooseCustomer")
          : t("purchases.chooseSupplier")
      }
    >
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="pp-name">
                {t(`${ns}.name` as never)}
              </FieldLabel>
              <Input
                id="pp-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pp-phone">
                {t(`${ns}.phone` as never)}
              </FieldLabel>
              <Input
                id="pp-phone"
                inputMode="tel"
                value={phone}
                aria-invalid={!phoneOk}
                onChange={(e) => setPhone(e.target.value)}
              />
              {!phoneOk ? (
                <p role="alert" className="text-sm text-destructive">
                  {t("validation.invalidPhone")}
                </p>
              ) : null}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAdding(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={saving || !name.trim() || !phoneOk}
              >
                {t("common.save")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(`${ns}.searchPlaceholder` as never)}
              aria-label={t(`${ns}.searchPlaceholder` as never)}
              className="ps-9"
              inputMode="search"
            />
          </div>
          <ul className="max-h-[45dvh] overflow-y-auto">
            <Option
              selected={selectedId === null}
              onClick={() => choose(null, "")}
              title={noneLabel}
            />
            {parties.map((p) => (
              <Option
                key={p.id}
                selected={selectedId === p.id}
                onClick={() => choose(p.id, p.name)}
                title={p.name}
                subtitle={p.phone}
                badge={p.balance > 0 ? f.money(p.balance) : undefined}
              />
            ))}
          </ul>
          <Button variant="outline" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden />
            {t(`${ns}.add` as never)}
          </Button>
        </div>
      )}
    </ResponsiveDialog>
  );
}

function Option({
  title,
  subtitle,
  badge,
  selected,
  onClick,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-start hover:bg-muted",
          selected && "bg-muted",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          {subtitle ? (
            <span className="block truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </span>
        {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        {selected ? (
          <Check className="size-4 text-primary" aria-hidden />
        ) : null}
      </button>
    </li>
  );
}
