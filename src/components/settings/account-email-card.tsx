"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { emailSchema } from "@/schemas/auth";
import { api } from "./api";

/**
 * The owner's email, where "forgot password" sends its link. Shops made before email was asked for
 * have none yet. It needs the internet (the sign-in service lives on the server).
 */
export function AccountEmailCard() {
  const t = useTranslations("settings.accountEmail");
  const tv = useTranslations("validation");
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [value, setValue] = useState("");
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ email: string | null }>("/api/account/email").then((r) => {
      if (r.ok && r.data) {
        setSaved(r.data.email);
        setValue(r.data.email ?? "");
      } else if (r.offline || r.status >= 500) setOffline(true);
    });
  }, []);

  async function save() {
    setError(null);
    const parsed = emailSchema.safeParse(value);
    if (!parsed.success) {
      setError(tv("emailInvalid"));
      return;
    }
    const result = await api<{ email: string }>("/api/account/email", {
      method: "PATCH",
      body: { email: parsed.data },
    });
    if (result.ok && result.data) {
      setSaved(result.data.email);
      setValue(result.data.email);
      toast.success(t("saved"));
    } else if (result.offline) setOffline(true);
    else setError(result.code === "EMAIL_TAKEN" ? t("taken") : t("failed"));
  }

  return (
    <Card data-testid="account-email-card">
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {saved === null ? (
          <p className="rounded-lg bg-amber-500/10 p-2 text-sm">{t("none")}</p>
        ) : null}
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="account-email">{t("label")}</FieldLabel>
          <Input
            id="account-email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={offline}
            aria-invalid={!!error}
            data-testid="account-email-input"
          />
          <FieldDescription>
            {offline ? t("needsInternet") : t("hint")}
          </FieldDescription>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </Field>
        <Button
          className="self-end"
          onClick={() => void save()}
          disabled={offline || value.trim() === "" || value === (saved ?? "")}
          data-testid="account-email-save"
        >
          <Check aria-hidden />
          {t("save")}
        </Button>
      </CardContent>
    </Card>
  );
}
