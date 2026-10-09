"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import { peekSku } from "@/commands/local/sku";
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
import { errorCode, isOffline } from "@/data/errors";
import {
  useCategories,
  useCommand,
  useDuplicateCodeCheck,
  useRecord,
} from "@/data/hooks";
import { useDataMode } from "@/data/mode-store";
import { getLocalDb } from "@/db/local/db";
import { getDeviceId } from "@/db/local/meta";
import type { Product } from "@/db/local/types";
import { newId } from "@/lib/ids";
import { parseMoney } from "@/lib/money";
import { parseQty, roundToUnit } from "@/lib/qty";
import { UNIT_CODES, unitDecimals } from "@/lib/units";
import { usePreferences } from "@/stores/preferences";

const NONE = "none";

/** A price must be entered and be more than zero. */
const priceText = z
  .string()
  .refine((v) => v.trim() !== "", { error: "required" })
  .refine((v) => v.trim() === "" || parseMoney(v) !== null, {
    error: "invalidNumber",
  })
  .refine((v) => (parseMoney(v) ?? 1) > 0, { error: "positive" });
const qtyText = z
  .string()
  .refine((v) => v.trim() === "" || parseQty(v) !== null, {
    error: "invalidNumber",
  });

/** Only the name and the two prices are required; everything else is optional. */
const makeFormSchema = (showsCost: boolean) =>
  z
    .object({
      name: z.string().trim().min(1, { error: "required" }).max(120),
      sku: z.string().trim().max(60),
      barcode: z.string().trim().max(60),
      categoryId: z.string(),
      unit: z.enum(UNIT_CODES),
      // People who cannot see the cost never fill it in, so it is not required of them.
      purchasePrice: showsCost ? priceText : z.string(),
      sellingPrice: priceText,
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
type FormValues = z.infer<ReturnType<typeof makeFormSchema>>;

const takaText = (poisha: number) =>
  poisha % 100 === 0 ? String(poisha / 100) : (poisha / 100).toFixed(2);
const qtyString = (milli: number) => String(milli / 1000);

export function ProductFormScreen() {
  const t = useTranslations();
  const { role } = useProfile();
  const id = useSearchParams().get("id");
  const editing = id !== null;

  const loaded = useRecord("products", id);
  const product = loaded.record as Product | undefined;

  if (!can(role, editing ? "product.edit" : "product.create")) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.noAccess")}
      </p>
    );
  }
  if (editing && loaded.status === "loading")
    return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  if (editing && (!product || loaded.status !== "ready" || product.deletedAt)) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("products.notFound")}
      </p>
    );
  }
  return <ProductForm key={id ?? "new"} product={product} />;
}

function ProductForm({ product }: { product?: Product }) {
  const t = useTranslations();
  const router = useRouter();
  const run = useCommand();
  const dataMode = useDataMode();
  const checkDuplicate = useDuplicateCodeCheck();
  const { role } = useProfile();
  const locale = usePreferences((s) => s.locale);
  const canSeeCost = can(role, "purchasePrice.view");

  const categories = useCategories()?.filter((c) => c.isActive);

  const {
    register,
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(makeFormSchema(canSeeCost)),
    defaultValues: {
      name: product?.name ?? "",
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
  const cost = parseMoney(watch("purchasePrice")) ?? 0;
  const price = parseMoney(watch("sellingPrice")) ?? 0;
  const sellsAtLoss = canSeeCost && cost > 0 && price > 0 && price < cost;

  // A blank SKU is filled in automatically when the product is saved; show which one it will be.
  // (Not a live query: finding the device id may have to create it, which is a write.)
  const [nextSku, setNextSku] = useState<string>();
  useEffect(() => {
    // Online, the server hands out the number when the product is saved, so there is nothing to show.
    if (product || dataMode !== "offline") return;
    let cancelled = false;
    const db = getLocalDb();
    void getDeviceId(db)
      .then((deviceId) => peekSku(db, deviceId))
      .then((sku) => !cancelled && setNextSku(sku))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [product, dataMode]);

  const onSubmit = handleSubmit(async (v) => {
    // Online, the server refuses a used code in the save itself (below); asking first would be two
    // requests one after the other before the real one.
    for (const field of dataMode === "online"
      ? []
      : (["barcode", "sku"] as const)) {
      const clash = await checkDuplicate(field, v[field], product?.id);
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
      // One name, in whichever language the shop writes it. (An older separate Bangla name is
      // cleared on the next save, so the product is shown and found by this one name only.)
      nameBn: "",
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
          await run(
            "product.update",
            { id: product.id, changes },
            { baseVersion: product.version },
          );
        router.push(`/products/view?id=${product.id}`);
      }
    } catch (error) {
      const code = errorCode(error);
      if (code === "DUPLICATE_SKU" || code === "DUPLICATE_BARCODE") {
        const field = code === "DUPLICATE_SKU" ? "sku" : "barcode";
        setError(field, {
          type: "duplicate",
          message: t(
            field === "sku"
              ? "products.duplicateSkuGeneric"
              : "products.duplicateBarcodeGeneric",
          ),
        });
        return;
      }
      toast.error(
        isOffline(error)
          ? t("common.noInternetSaving")
          : t("common.somethingWrong"),
      );
    }
  });

  const unitLabel = t(`units.${unit}`);
  const text = (
    name: keyof FormValues,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
    required = false,
  ) => (
    <Field data-invalid={!!errors[name]}>
      {/* The star is drawn by CSS, so the label's text (and its accessible name) is unchanged. */}
      <FieldLabel
        htmlFor={`f-${name}`}
        className={
          required
            ? "after:ms-0.5 after:text-destructive after:content-['*']"
            : undefined
        }
      >
        {label}
      </FieldLabel>
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
        {text(
          "name",
          t("products.name"),
          { autoFocus: !product, placeholder: t("products.namePlaceholder") },
          true,
        )}

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
          {canSeeCost
            ? text(
                "purchasePrice",
                `${t("products.purchasePrice")} (৳)`,
                { inputMode: "decimal" },
                true,
              )
            : null}
          <div className="flex flex-col gap-1">
            {text(
              "sellingPrice",
              `${t("products.sellingPrice")} (৳)`,
              { inputMode: "decimal" },
              true,
            )}
            {sellsAtLoss ? (
              <p
                className="text-xs text-amber-600 dark:text-amber-400"
                data-testid="below-cost"
              >
                {t("products.belowCost")}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.sku}>
            <FieldLabel htmlFor="f-sku">{t("products.sku")}</FieldLabel>
            <Input
              id="f-sku"
              autoCapitalize="characters"
              placeholder={
                nextSku ? t("products.skuAuto", { sku: nextSku }) : undefined
              }
              aria-invalid={!!errors.sku}
              {...register("sku")}
            />
            <ValidationError error={errors.sku} />
            {!product ? (
              <FieldDescription>{t("products.skuHint")}</FieldDescription>
            ) : null}
          </Field>
          {text("barcode", t("products.barcode"), { inputMode: "numeric" })}
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
