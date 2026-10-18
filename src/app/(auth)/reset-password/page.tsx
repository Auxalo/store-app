"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/auth/client";
import { ValidationError } from "@/components/shared/field-text";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { passwordSchema } from "@/schemas/auth";

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    error: "passwordsDiffer",
  });
type Values = z.input<typeof schema>;

/** The page the emailed link opens: choose a new password (the link works once, for an hour). */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const t = useTranslations("auth");
  const params = useSearchParams();
  const token = params.get("token");
  const linkBroken = !token || params.get("error") !== null;
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    let error: { status: number } | null;
    try {
      ({ error } = await authClient.resetPassword({
        newPassword: values.password,
        token: token ?? "",
      }));
    } catch {
      setFormError(t("needInternetToSignIn"));
      return;
    }
    if (error) {
      setFormError(
        error.status >= 500 ? t("serverProblem") : t("resetInvalid"),
      );
      return;
    }
    setDone(true);
  });

  if (done)
    return (
      <>
        <p
          className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm"
          role="status"
          data-testid="reset-done"
        >
          <CheckCircle2
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden
          />
          {t("resetDone")}
        </p>
        <Button asChild size="lg">
          <Link href="/login">{t("signIn")}</Link>
        </Button>
      </>
    );

  if (linkBroken)
    return (
      <>
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
          data-testid="reset-invalid"
        >
          {t("resetInvalid")}
        </p>
        <Button asChild size="lg" variant="outline">
          <Link href="/forgot-password">{t("requestAgain")}</Link>
        </Button>
      </>
    );

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("resetTitle")}</h1>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">{t("newPassword")}</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            <ValidationError error={errors.password} />
          </Field>
          <Field data-invalid={!!errors.confirm}>
            <FieldLabel htmlFor="confirm">{t("confirmPassword")}</FieldLabel>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirm}
              {...register("confirm")}
            />
            <ValidationError error={errors.confirm} />
          </Field>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : null}
            {isSubmitting ? t("resetting") : t("resetSave")}
          </Button>
        </FieldGroup>
      </form>
    </>
  );
}
