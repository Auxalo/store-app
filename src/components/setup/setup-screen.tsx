"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { can } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";
import type { StoreProfile } from "@/components/settings/settings-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useSetting } from "@/hooks/use-setting";
import { useFormat } from "@/i18n/use-format";
import { SETUP_SETTING } from "@/lib/constants";
import type { SetupKind } from "@/setup/rows";
import { type SetupRow, SetupTable } from "./setup-table";

const STEPS = ["store", "products", "customers", "suppliers", "done"] as const;
type Step = (typeof STEPS)[number];

const NO_PROFILE: StoreProfile = { name: "", address: "", phone: "" };

/**
 * First-time setup: bring in what the shop already has (products with stock, customers who owe
 * money, suppliers the shop owes), one step at a time. Every step can be skipped, and the whole
 * thing can be reached again from Settings.
 */
export function SetupScreen() {
  const t = useTranslations("setup");
  const router = useRouter();
  const f = useFormat();
  const { role, storeName } = useProfile();
  const done = useSetting<string>(SETUP_SETTING, "");
  const profile = useSetting<StoreProfile>("store.profile", NO_PROFILE);

  const [step, setStep] = useState<Step>("store");
  const [rows, setRows] = useState<Record<SetupKind, SetupRow[]>>({
    products: [],
    customers: [],
    suppliers: [],
  });
  const [added, setAdded] = useState<Record<SetupKind, number>>({
    products: 0,
    customers: 0,
    suppliers: 0,
  });
  const [form, setForm] = useState<StoreProfile>({
    ...NO_PROFILE,
    name: storeName ?? "",
  });

  const savedProfile = JSON.stringify(profile.value);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refill only when the saved value changes
  useEffect(
    () =>
      setForm({
        ...NO_PROFILE,
        ...profile.value,
        name: profile.value.name || (storeName ?? ""),
      }),
    [savedProfile, storeName],
  );

  if (!can(role, "settings.manage"))
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("noAccess")}
      </p>
    );

  const index = STEPS.indexOf(step);
  const go = (next: Step) => setStep(next);
  const finish = async (to: string) => {
    if (!done.value) await done.set(new Date().toISOString());
    router.push(to);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void finish("/dashboard")}
          data-testid="setup-skip"
        >
          {t("skip")}
        </Button>
      </div>

      <ol className="flex gap-1 overflow-x-auto" aria-label={t("title")}>
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button
              type="button"
              onClick={() => go(s)}
              aria-current={s === step ? "step" : undefined}
              data-testid={`setup-step-${s}`}
              className={`flex w-full min-w-24 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium ${
                s === step
                  ? "border-primary bg-primary/10 text-primary"
                  : i < index
                    ? "text-foreground"
                    : "text-muted-foreground"
              }`}
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full text-[11px] ${
                  s === step ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {i < index && s !== "done" ? (
                  <Check className="size-3" aria-hidden />
                ) : (
                  i + 1
                )}
              </span>
              {t(`steps.${s}`)}
            </button>
          </li>
        ))}
      </ol>

      {step === "store" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("steps.store")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("storeIntro")}</p>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void profile.set(form).then(() => {
                  toast.success(t("storeSaved"));
                  go("products");
                });
              }}
            >
              <FieldGroup>
                {(["name", "address", "phone"] as const).map((field) => (
                  <Field key={field}>
                    <FieldLabel htmlFor={`setup-store-${field}`}>
                      {t(`store.${field}`)}
                    </FieldLabel>
                    <Input
                      id={`setup-store-${field}`}
                      value={form[field]}
                      maxLength={120}
                      inputMode={field === "phone" ? "tel" : undefined}
                      onChange={(e) =>
                        setForm({ ...form, [field]: e.target.value })
                      }
                      data-testid={`setup-store-${field}`}
                    />
                  </Field>
                ))}
                <div className="flex justify-end">
                  <Button type="submit" data-testid="setup-store-save">
                    {t("saveContinue")}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {step === "products" || step === "customers" || step === "suppliers" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t(`steps.${step}`)}</CardTitle>
            <p className="text-sm text-muted-foreground">{t(`${step}Intro`)}</p>
            {step === "customers" || step === "suppliers" ? (
              <p className="text-xs text-muted-foreground">
                {t("balanceHint")}
              </p>
            ) : null}
          </CardHeader>
          <CardContent>
            <SetupTable
              key={step}
              kind={step}
              rows={rows[step]}
              onRows={(next) => setRows((r) => ({ ...r, [step]: next }))}
              onSaved={(count) =>
                setAdded((a) => ({ ...a, [step]: a[step] + count }))
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {step === "done" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("doneTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm" data-testid="setup-done-summary">
              {t("doneBody", {
                products: f.integer(added.products),
                customers: f.integer(added.customers),
                suppliers: f.integer(added.suppliers),
              })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void finish("/pos")}
                data-testid="setup-open-pos"
              >
                {t("openPos")}
              </Button>
              <Button
                variant="outline"
                onClick={() => void finish("/dashboard")}
                data-testid="setup-finish"
              >
                {t("goDashboard")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step !== "store" && step !== "done" ? (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => go(STEPS[index - 1])}>
            {t("back")}
          </Button>
          <Button
            variant="outline"
            onClick={() => go(STEPS[index + 1])}
            data-testid="setup-next"
          >
            {rows[step as SetupKind].length > 0 ? t("nextWithout") : t("next")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
