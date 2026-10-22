"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { authClient } from "@/auth/client";
import { ValidationError } from "@/components/shared/field-text";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DEVELOPER } from "@/config/developer";
import { emailSchema } from "@/schemas/auth";

const schema = z.object({ email: emailSchema });
type Values = z.input<typeof schema>;

/**
 * "Forgot password": the owner types the email they gave when opening the shop and a link to set a
 * new password is mailed. The answer is the same whether or not that email has an account, so the
 * page cannot be used to find out who is a customer.
 */
export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    let error: { status: number } | null;
    try {
      ({ error } = await authClient.requestPasswordReset({
        email: values.email.trim().toLowerCase(),
        redirectTo: "/reset-password",
      }));
    } catch {
      setFormError(t("needInternetToSignIn"));
      return;
    }
    // Asking too often is refused; anything else looks the same to the person.
    if (error?.status === 0 || (error && error.status >= 500)) {
      setFormError(t("serverProblem"));
      return;
    }
    if (error?.status === 429) {
      setFormError(t("tooManyTries"));
      return;
    }
    setSent(true);
  });

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("forgotTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("forgotSubtitle")}</p>
      </div>

      {sent ? (
        <p
          className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm"
          role="status"
          data-testid="forgot-sent"
        >
          <MailCheck
            className="mt-0.5 size-4 shrink-0 text-primary"
            aria-hidden
          />
          {t("linkSent")}
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                inputMode="email"
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              <ValidationError error={errors.email} />
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
              {isSubmitting ? t("sendingLink") : t("sendLink")}
            </Button>
          </FieldGroup>
        </form>
      )}

      <div
        className="space-y-1 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"
        data-testid="forgot-help"
      >
        <p>{t("forgotStaff")}</p>
        <p>
          {t("forgotNoMail", { name: DEVELOPER.name })}{" "}
          <a
            href={DEVELOPER.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            WhatsApp {DEVELOPER.whatsapp}
          </a>
          {" · "}
          <a
            href={DEVELOPER.messengerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline-offset-4 hover:underline"
            data-testid="forgot-messenger"
          >
            Messenger
          </a>
        </p>
      </div>

      <p className="text-center text-sm">
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("backToLogin")}
        </Link>
      </p>
    </>
  );
}
