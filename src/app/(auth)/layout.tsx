"use client";

import { Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { useAuth } from "@/auth/use-auth";
import { LanguageSwitch } from "@/components/layout/language-switch";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("app");
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "authenticated") router.replace("/dashboard");
  }, [auth.status, router]);

  if (auth.status === "authenticated") return <FullScreenLoader />;

  return (
    <div className="flex min-h-dvh flex-col px-4 pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2 font-semibold">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Store className="size-4" aria-hidden />
          </div>
          {t("name")}
        </div>
        <LanguageSwitch />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-8">
        {children}
      </main>
    </div>
  );
}
