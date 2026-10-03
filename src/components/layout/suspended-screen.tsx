"use client";

import { Globe, MessageCircle, PauseCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { signOut } from "@/auth/use-auth";
import { Button } from "@/components/ui/button";
import { DEVELOPER } from "@/config/developer";

/**
 * Shown instead of the app when the operator has paused this shop (for example a month not paid).
 * Nothing is lost: everything on the device is kept and comes back the moment the shop is resumed.
 */
export function SuspendedScreen() {
  const t = useTranslations("suspended");
  const td = useTranslations("developer");
  const ta = useTranslations("account");
  const router = useRouter();
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
      data-testid="suspended-screen"
    >
      <PauseCircle className="size-12 text-amber-500" aria-hidden />
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("body", { name: DEVELOPER.name })}
      </p>
      <div className="flex flex-col gap-2 text-sm">
        <a
          href={DEVELOPER.siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 text-primary hover:underline"
        >
          <Globe className="size-4" aria-hidden />
          {DEVELOPER.site}
        </a>
        <a
          href={DEVELOPER.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 text-primary hover:underline"
        >
          <MessageCircle className="size-4" aria-hidden />
          {td("whatsapp")}: {DEVELOPER.whatsapp}
        </a>
      </div>
      <p className="max-w-sm text-xs text-muted-foreground">{t("safe")}</p>
      <Button
        variant="outline"
        onClick={() => {
          void signOut().then((done) => {
            if (done) router.replace("/login");
            else toast.error(ta("signOutFailed"));
          });
        }}
      >
        {t("signOut")}
      </Button>
    </div>
  );
}
