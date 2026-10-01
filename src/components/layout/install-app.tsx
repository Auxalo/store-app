"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useEventListener } from "usehooks-ts";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** Install entry for the account menu: native prompt on Android/desktop, a hint on iOS. */
export function InstallAppMenuItem() {
  const t = useTranslations("pwa");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    setIosHint(/iphone|ipad|ipod/i.test(navigator.userAgent));
  }, []);

  useEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    setDeferred(event);
  });
  useEventListener("appinstalled", () => setDeferred(null));

  if (!deferred && !iosHint) return null;

  return (
    <DropdownMenuItem
      onSelect={async () => {
        if (deferred) {
          await deferred.prompt();
          await deferred.userChoice;
          setDeferred(null);
        } else {
          toast.info(t("installIos"));
        }
      }}
    >
      <Download aria-hidden />
      {t("install")}
    </DropdownMenuItem>
  );
}
