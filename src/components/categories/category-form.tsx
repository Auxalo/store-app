"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { ValidationError } from "@/components/shared/field-text";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Category } from "@/db/local/types";
import {
  type CategoryFormValues,
  categoryFormSchema,
} from "@/schemas/category";

interface CategoryFormProps {
  category?: Category;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
  onCancel: () => void;
}

export function CategoryForm({
  category,
  onSubmit,
  onCancel,
}: CategoryFormProps) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: category?.name ?? "",
      nameBn: category?.nameBn ?? "",
      description: category?.description ?? "",
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="cat-name">{t("categories.name")}</FieldLabel>
          <Input
            id="cat-name"
            autoFocus
            aria-invalid={!!errors.name}
            {...register("name")}
          />
          <ValidationError error={errors.name} />
        </Field>
        <Field data-invalid={!!errors.nameBn}>
          <FieldLabel htmlFor="cat-name-bn">
            {t("categories.nameBn")}
          </FieldLabel>
          <Input
            id="cat-name-bn"
            lang="bn"
            aria-invalid={!!errors.nameBn}
            {...register("nameBn")}
          />
          <ValidationError error={errors.nameBn} />
        </Field>
        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="cat-description">
            {t("categories.description")}
          </FieldLabel>
          <Input
            id="cat-description"
            aria-invalid={!!errors.description}
            {...register("description")}
          />
          <ValidationError error={errors.description} />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
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
