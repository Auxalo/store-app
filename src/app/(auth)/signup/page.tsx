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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type OwnerSignupInput, ownerSignupSchema } from "@/schemas/auth";
import { useActiveUser } from "@/stores/active-user";

export default function SignupPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OwnerSignupInput>({
    resolver: zodResolver(ownerSignupSchema),
    defaultValues: { storeName: "", ownerName: "", username: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (!navigator.onLine) {
      setFormError(t("needInternetToSignIn"));
      return;
    }
    let response: Response;
    try {
      response = await fetch("/api/stores", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
    } catch {
      setFormError(t("needInternetToSignIn"));
      return;
    }
    if (response.status === 409) {
      setFormError(t("usernameTaken"));
      return;
    }
    if (!response.ok) {
      setFormError(t("needInternetToSignIn"));
      return;
    }
    const { error } = await authClient.signIn.username({
      username: values.username.trim().toLowerCase(),
      password: values.password,
    });
    if (error) {
      router.replace("/login");
      return;
    }
    useActiveUser.getState().openAsAccount();
    router.replace("/");
  });

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("signUpTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("signUpSubtitle")}</p>
      </div>

      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          <Field data-invalid={!!errors.storeName}>
            <FieldLabel htmlFor="storeName">{t("storeName")}</FieldLabel>
            <Input
              id="storeName"
              autoComplete="organization"
              aria-invalid={!!errors.storeName}
              {...register("storeName")}
            />
            <ValidationError error={errors.storeName} />
          </Field>

          <Field data-invalid={!!errors.ownerName}>
            <FieldLabel htmlFor="ownerName">{t("ownerName")}</FieldLabel>
            <Input
              id="ownerName"
              autoComplete="name"
              aria-invalid={!!errors.ownerName}
              {...register("ownerName")}
            />
            <ValidationError error={errors.ownerName} />
          </Field>

          <Field data-invalid={!!errors.username}>
            <FieldLabel htmlFor="username">{t("username")}</FieldLabel>
            <Input
              id="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              aria-invalid={!!errors.username}
              {...register("username")}
            />
            <ValidationError error={errors.username} />
          </Field>

          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
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
            {isSubmitting ? t("creating") : t("createAccount")}
          </Button>
        </FieldGroup>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          href="/login"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("signIn")}
        </Link>
      </p>
    </>
  );
}
