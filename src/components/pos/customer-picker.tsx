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
import { searchCustomers } from "@/db/local/queries/customers";
import { useFormat } from "@/i18n/use-format";
import { newId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { useCart } from "@/stores/cart";
import { useCommands } from "@/sync/use-commands";

/** Choose who the sale is for: nobody (walk-in), an existing customer, or a new one added on the spot. */
export function CustomerPicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations();
  const f = useFormat();
  const run = useCommands();
  const selectedId = useCart((s) => s.customerId);
  const setCustomer = useCart((s) => s.setCustomer);

  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const customers =
    useLiveQuery(() => searchCustomers(getLocalDb(), deferred), [deferred]) ??
    [];

  const choose = (id: string | null, label: string) => {
    setCustomer(id, label);
    onOpenChange(false);
  };

  async function addCustomer() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const id = newId();
      await run("customer.create", {
        id,
        name: name.trim(),
        phone: phone.trim(),
      });
      setName("");
      setPhone("");
      setAdding(false);
      choose(id, name.trim());
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
      title={t("pos.chooseCustomer")}
    >
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addCustomer();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-customer-name">
                {t("customers.name")}
              </FieldLabel>
              <Input
                id="new-customer-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-customer-phone">
                {t("customers.phone")}
              </FieldLabel>
              <Input
                id="new-customer-phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAdding(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
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
              placeholder={t("customers.searchPlaceholder")}
              aria-label={t("customers.searchPlaceholder")}
              className="ps-9"
              inputMode="search"
            />
          </div>

          <ul
            className="max-h-[45dvh] overflow-y-auto"
            data-testid="customer-list"
          >
            <Row
              selected={selectedId === null}
              onClick={() => choose(null, "")}
              title={t("pos.walkIn")}
            />
            {customers.map((c) => (
              <Row
                key={c.id}
                selected={selectedId === c.id}
                onClick={() => choose(c.id, c.name)}
                title={c.name}
                subtitle={c.phone}
                badge={
                  c.balance > 0
                    ? `${t("customers.due")} ${f.money(c.balance)}`
                    : undefined
                }
              />
            ))}
          </ul>

          <Button variant="outline" onClick={() => setAdding(true)}>
            <UserPlus aria-hidden />
            {t("customers.quickAdd")}
          </Button>
        </div>
      )}
    </ResponsiveDialog>
  );
}

function Row({
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
