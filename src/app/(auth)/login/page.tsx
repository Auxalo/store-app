"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { authClient } from "@/auth/client";
import { ValidationError } from "@/components/shared/field-text";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type LoginInput, loginSchema } from "@/schemas/auth";

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (!navigator.onLine) {
      setFormError(t("needInternetToSignIn"));
      return;
    }
    const { error } = await authClient.signIn.username({
      username: values.username.trim().toLowerCase(),
      password: values.password,
    });
    if (error) {
      setFormError(
        error.status === 0 || error.status >= 500
          ? t("needInternetToSignIn")
          : t("invalidCredentials"),
      );
      return;
    }
    router.replace("/dashboard");
  });

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("loginTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("loginSubtitle")}</p>
      </div>

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={!!errors.username}>
            <FieldLabel htmlFor="username">{t("username")}</FieldLabel>
            <Input
              id="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="text"
              aria-invalid={!!errors.username}
              {...register("username")}
            />
            <ValidationError error={errors.username} />
            <FieldDescription>{t("usernameHint")}</FieldDescription>
          </Field>

          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            <ValidationError error={errors.password} />
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
            {isSubmitting ? t("signingIn") : t("signIn")}
          </Button>
        </FieldGroup>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {t("noStore")}{" "}
        <Link
          href="/signup"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("createStore")}
        </Link>
      </p>
    </>
  );
}
