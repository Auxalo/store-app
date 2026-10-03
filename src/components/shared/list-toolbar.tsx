"use client";

import { ListFilter, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { ResponsiveDialog } from "@/components/shared/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface Option {
  value: string;
  label: string;
}

/** One thing a list can be narrowed by. */
export type FilterField =
  | {
      kind: "choice";
      key: string;
      label: string;
      options: Option[];
      /** The value that means "not filtered" (shown as the first option). */
      none: string;
    }
  | { kind: "toggle"; key: string; label: string }
  | { kind: "dates"; fromKey: string; toKey: string; label: string };

export type FilterValues = Record<string, string | boolean | undefined>;

interface ListToolbarProps {
  /** Omit `onSearch` for lists that have nothing to search by words (payments, returns). */
  search?: string;
  onSearch?: (value: string) => void;
  placeholder?: string;
  fields?: FilterField[];
  values?: FilterValues;
  onValue?: (key: string, value: string | boolean | undefined) => void;
  sort?: string;
  sortOptions?: Option[];
  onSort?: (value: string) => void;
  /** Called by "Clear": the screen resets the filters it owns. */
  onClear?: () => void;
  /** Extra controls after the sort menu (for example an "Add" button). */
  trailing?: ReactNode;
  testId?: string;
}

const isSet = (field: FilterField, values: FilterValues) =>
  field.kind === "choice"
    ? !!values[field.key] && values[field.key] !== field.none
    : field.kind === "toggle"
      ? values[field.key] === true
      : !!values[field.fromKey] || !!values[field.toKey];

/**
 * The controls over every list: a search box, a Filters panel, a sort menu, and a chip for each
 * filter that is on (tap the chip to remove it). It only edits the question; the screen asks the
 * data layer, which answers the same way online or offline.
 */
export function ListToolbar({
  search = "",
  onSearch,
  placeholder = "",
  fields = [],
  values = {},
  onValue,
  sort,
  sortOptions,
  onSort,
  onClear,
  trailing,
  testId = "list-toolbar",
}: ListToolbarProps) {
  const t = useTranslations("list");
  const [open, setOpen] = useState(false);
  const active = fields.filter((f) => isSet(f, values));

  const clearField = (field: FilterField) => {
    if (field.kind === "choice") onValue?.(field.key, field.none);
    else if (field.kind === "toggle") onValue?.(field.key, false);
    else {
      onValue?.(field.fromKey, undefined);
      onValue?.(field.toKey, undefined);
    }
  };
  const chipText = (field: FilterField) => {
    if (field.kind === "choice")
      return `${field.label}: ${field.options.find((o) => o.value === values[field.key])?.label ?? values[field.key]}`;
    if (field.kind === "toggle") return field.label;
    return `${field.label}: ${values[field.fromKey] ?? "…"} → ${values[field.toKey] ?? "…"}`;
  };

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        {onSearch ? (
          <div className="relative min-w-0 basis-full sm:basis-0 sm:flex-1">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="px-9"
              inputMode="search"
              data-testid="list-search"
            />
            {search ? (
              <button
                type="button"
                onClick={() => onSearch("")}
                aria-label={t("clearSearch")}
                className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
                data-testid="list-search-clear"
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {fields.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
            data-testid="list-filters"
          >
            <ListFilter aria-hidden />
            <span className="max-sm:sr-only">{t("filters")}</span>
            {active.length > 0 ? (
              <Badge variant="secondary" data-testid="list-filter-count">
                {active.length}
              </Badge>
            ) : null}
          </Button>
        ) : null}
        {sortOptions && sort && onSort ? (
          <Select value={sort} onValueChange={onSort}>
            <SelectTrigger
              className="w-auto min-w-28 max-w-44 max-sm:max-w-none max-sm:flex-1"
              aria-label={t("sort")}
              data-testid="list-sort"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {sortOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {trailing}
      </div>

      {active.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1.5"
          data-testid="list-chips"
        >
          {active.map((field) => (
            <button
              type="button"
              key={field.kind === "dates" ? field.fromKey : field.key}
              onClick={() => clearField(field)}
              className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1 text-xs hover:bg-muted"
              data-testid="list-chip"
            >
              {chipText(field)}
              <X className="size-3" aria-hidden />
            </button>
          ))}
          {onClear ? (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-primary"
              data-testid="list-clear"
            >
              {t("clear")}
            </button>
          ) : null}
        </div>
      ) : null}

      <ResponsiveDialog open={open} onOpenChange={setOpen} title={t("filters")}>
        <FieldGroup>
          {fields.map((field) =>
            field.kind === "choice" ? (
              <Field key={field.key}>
                <FieldLabel>{field.label}</FieldLabel>
                <Select
                  value={String(values[field.key] ?? field.none)}
                  onValueChange={(v) => onValue?.(field.key, v)}
                >
                  <SelectTrigger
                    className="w-full"
                    data-testid={`filter-${field.key}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : field.kind === "toggle" ? (
              <Field key={field.key} orientation="horizontal">
                <Switch
                  id={`filter-${field.key}`}
                  checked={values[field.key] === true}
                  onCheckedChange={(v) => onValue?.(field.key, v)}
                  data-testid={`filter-${field.key}`}
                />
                <FieldLabel htmlFor={`filter-${field.key}`}>
                  {field.label}
                </FieldLabel>
              </Field>
            ) : (
              <div key={field.fromKey} className="grid grid-cols-2 gap-2">
                {([field.fromKey, field.toKey] as const).map((key, i) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={`filter-${key}`}>
                      {i === 0 ? t("from") : t("to")}
                    </FieldLabel>
                    <Input
                      id={`filter-${key}`}
                      type="date"
                      value={String(values[key] ?? "")}
                      onChange={(e) =>
                        onValue?.(key, e.target.value || undefined)
                      }
                      data-testid={`filter-${key}`}
                    />
                  </Field>
                ))}
              </div>
            ),
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {onClear ? (
              <Button
                type="button"
                variant="outline"
                onClick={onClear}
                data-testid="filters-clear"
              >
                {t("clear")}
              </Button>
            ) : null}
            <Button
              type="button"
              onClick={() => setOpen(false)}
              data-testid="filters-done"
            >
              {t("done")}
            </Button>
          </div>
        </FieldGroup>
      </ResponsiveDialog>
    </div>
  );
}
