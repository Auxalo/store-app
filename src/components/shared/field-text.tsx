"use client";

import { useTranslations } from "next-intl";
import type { FieldError as RhfFieldError } from "react-hook-form";
import { FieldError } from "@/components/ui/field";

/** Shows a react-hook-form error whose message is a key in the "validation" namespace. */
export function ValidationError({ error }: { error?: RhfFieldError }) {
  const t = useTranslations("validation");
  if (!error?.message) return null;
  const key = error.message as Parameters<typeof t>[0];
  return <FieldError>{t.has(key) ? t(key) : error.message}</FieldError>;
}
