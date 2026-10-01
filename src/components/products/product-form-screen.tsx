"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLiveQuery } from "dexie-react-hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { ValidationError } from "@/components/shared/field-text";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { getLocalDb } from "@/db/local/db";
import { findDuplicateCode } from "@/db/local/queries/products";
import type { Product } from "@/db/local/types";
import { newId } from "@/lib/ids";
import { parseMoney } from "@/lib/money";
import { parseQty, roundToUnit } from "@/lib/qty";
import { UNIT_CODES, unitDecimals } from "@/lib/units";
import { usePreferences } from "@/stores/preferences";
import { useCommands } from "@/sync/use-commands";

const NONE = "none";

const moneyText = z
  .string()
  .refine((v) => v.trim() === "" || (parseMoney(v) ?? -1) >= 0, {
    error: "invalidNumber",
  });
const qtyText = z
  .string()
  .refine((v) => v.trim() === "" || parseQty(v) !== null, {
    error: "invalidNumber",
  });

const formSchema = z
  .object({
    name: z.string().trim().min(1, { error: "required" }).max(120),
    nameBn: z.string().trim().max(120),
    sku: z.string().trim().max(60),
    barcode: z.string().trim().max(60),
    categoryId: z.string(),
    unit: z.enum(UNIT_CODES),
    purchasePrice: moneyText,
    sellingPrice: moneyText,
    lowStockThreshold: qtyText,
    openingStock: qtyText,
    description: z.string().trim().max(500),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const decimals = unitDecimals(v.unit);
    for (const field of ["lowStockThreshold", "openingStock"] as const) {
      const milli = v[field].trim() === "" ? 0 : parseQty(v[field]);
      if (milli !== null && roundToUnit(milli, decimals) !== milli) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "tooManyDecimals",
        });
      }
    }
  });
type FormValues = z.infer<typeof formSchema>;

const takaText = (poisha: number) =>
  poisha % 100 === 0 ? String(poisha / 100) : (poisha / 100).toFixed(2);
const qtyString = (milli: number) => String(milli / 1000);

export function ProductFormScreen() {
  const t = useTranslations();
  const { role } = useProfile();
  const id = useSearchParams().get("id");
  const editing = id !== null;

  const product = useLiveQuery(
    async () =>
      id ? ((await getLocalDb().products.get(id)) ?? null) : undefined,
    [id],
  );

  if (!can(role, editing ? "product.edit" : "product.create")) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.noAccess")}
      </p>
    );
  }
  if (editing && product === undefined)
    return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  if (editing && (product === null || product?.deletedAt)) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.notFound")}
      </p>
    );
  }
  return <ProductForm key={id ?? "new"} product={product ?? undefined} />;
}

function ProductForm({ product }: { product?: Product }) {
  const t = useTranslations();
  const router = useRouter();
  const run = useCommands();
  const { role } = useProfile();
  const locale = usePreferences((s) => s.locale);
  const canSeeCost = can(role, "purchasePrice.view");

  const categories = useLiveQuery(
    () =>
      getLocalDb()
        .categories.filter((c) => !c.deletedAt && c.isActive)
        .sortBy("name"),
    [],
  );

  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: product?.name ?? "",
      nameBn: product?.nameBn ?? "",
      sku: product?.sku ?? "",
      barcode: product?.barcode ?? "",
      categoryId: product?.categoryId ?? NONE,
      unit: product?.unit ?? "pcs",
      purchasePrice: product ? takaText(product.purchasePrice) : "",
      sellingPrice: product ? takaText(product.sellingPrice) : "",
      lowStockThreshold: product ? qtyString(product.lowStockThreshold) : "",
      openingStock: "",
      description: product?.description ?? "",
      isActive: product?.isActive ?? true,
    },
  });
  const unit = watch("unit");

  const onSubmit = handleSubmit(async (v) => {
    const db = getLocalDb();
    for (const field of ["barcode", "sku"] as const) {
      const clash = await findDuplicateCode(db, field, v[field], product?.id);
      if (clash) {
        setError(field, {
          type: "duplicate",
          message: t(
            field === "barcode"
              ? "products.duplicateBarcode"
              : "products.duplicateSku",
            { name: clash.name },
          ),
        });
        return;
      }
    }

    const next = {
      name: v.name,
      nameBn: v.nameBn,
      sku: v.sku,
      barcode: v.barcode,
      categoryId: v.categoryId === NONE ? null : v.categoryId,
      unit: v.unit,
      // Cashiers cannot see cost, so their form never carries (or changes) it.
      purchasePrice: canSeeCost
        ? (parseMoney(v.purchasePrice) ?? 0)
        : (product?.purchasePrice ?? 0),
      sellingPrice: parseMoney(v.sellingPrice) ?? 0,
      lowStockThreshold: parseQty(v.lowStockThreshold) ?? 0,
      description: v.description,
      isActive: v.isActive,
    };

    try {
      if (!product) {
        await run("product.create", {
          ...next,
          id: newId(),
          openingStock: parseQty(v.openingStock) ?? 0,
          openingMovementId: newId(),
        });
        router.push("/products");
      } else {
        const changes = Object.fromEntries(
          (Object.keys(next) as Array<keyof typeof next>)
            .filter((k) => next[k] !== product[k])
            .map((k) => [k, next[k]]),
        );
        if (Object.keys(changes).length > 0)
          await run("product.update", { id: product.id, changes });
        router.push(`/products/view?id=${product.id}`);
      }
    } catch {
      toast.error(t("common.somethingWrong"));
    }
  });

  const unitLabel = t(`units.${unit}`);
  const text = (
    name: keyof FormValues,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={`f-${name}`}>{label}</FieldLabel>
      <Input
        id={`f-${name}`}
        aria-invalid={!!errors[name]}
        {...register(name as never)}
        {...props}
      />
      <ValidationError error={errors[name] as never} />
    </Field>
  );

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="mx-auto flex w-full max-w-2xl flex-col gap-6"
    >
      <h2 className="text-lg font-semibold">
        {product ? t("products.editTitle") : t("products.newTitle")}
      </h2>
      <FieldGroup>
        {text("name", t("products.name"), { autoFocus: !product })}
        {text("nameBn", t("products.nameBn"), { lang: "bn" })}

        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={control}
            name="categoryId"
            render={({ field }) => (
              <Field>
                <FieldLabel>{t("products.category")}</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      {t("products.noCategory")}
                    </SelectItem>
                    {(categories ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {locale === "bn" && c.nameBn ? c.nameBn : c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          <Controller
            control={control}
            name="unit"
            render={({ field }) => (
              <Field>
                <FieldLabel>{t("products.unit")}</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_CODES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {t(`units.${u}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {text("sku", t("products.sku"), { autoCapitalize: "characters" })}
          {text("barcode", t("products.barcode"), { inputMode: "numeric" })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {canSeeCost
            ? text("purchasePrice", `${t("products.purchasePrice")} (৳)`, {
                inputMode: "decimal",
              })
            : null}
          {text("sellingPrice", `${t("products.sellingPrice")} (৳)`, {
            inputMode: "decimal",
          })}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {!product
            ? text(
                "openingStock",
                `${t("products.openingStock")} (${unitLabel})`,
                { inputMode: "decimal" },
              )
            : null}
          <Field data-invalid={!!errors.lowStockThreshold}>
            <FieldLabel htmlFor="f-lowStockThreshold">{`${t("products.lowStockThreshold")} (${unitLabel})`}</FieldLabel>
            <Input
              id="f-lowStockThreshold"
              inputMode="decimal"
              aria-invalid={!!errors.lowStockThreshold}
              {...register("lowStockThreshold")}
            />
            <ValidationError error={errors.lowStockThreshold} />
            <FieldDescription>{t("products.lowStockHint")}</FieldDescription>
          </Field>
        </div>

        {text("description", t("products.description"))}

        {product ? (
          <Controller
            control={control}
            name="isActive"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Switch
                  id="f-active"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                <FieldLabel htmlFor="f-active">
                  {t("products.active")}
                </FieldLabel>
              </Field>
            )}
          />
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t("common.save")}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
