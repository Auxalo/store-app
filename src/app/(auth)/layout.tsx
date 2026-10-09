"use client";

import { Store } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { can } from "@/auth/permissions";
import { useAuth } from "@/auth/use-auth";
import { LanguageSwitch } from "@/components/layout/language-switch";
import { DeveloperLinks } from "@/components/shared/developer-links";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";
import { homeFor } from "@/config/nav";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("app");
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const role = auth.status === "authenticated" ? auth.profile.role : undefined;

  // Someone who has just created a shop starts in the first-time setup; everyone else goes home.
  // (The sign-up page sends them to the same place, so the two never pull in different directions.)
  const target =
    pathname === "/signup" && can(role, "settings.manage")
      ? "/settings/setup"
      : homeFor(role);

  useEffect(() => {
    if (auth.status === "authenticated") router.replace(target);
  }, [auth.status, target, router]);

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
      <footer className="py-4">
        <DeveloperLinks centered />
      </footer>
    </div>
  );
}
