"use client";

import { Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { DEVELOPER } from "@/config/developer";
import { cn } from "@/lib/utils";

/** WhatsApp's mark (lucide has no brand icons). */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.05 21.5h-.01a9.43 9.43 0 0 1-4.8-1.32l-.35-.2-3.57.93.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.24-9.44 9.45-9.44 2.52 0 4.89.99 6.67 2.77a9.37 9.37 0 0 1 2.76 6.68c0 5.2-4.24 9.44-9.44 9.44zm8.03-17.47A11.28 11.28 0 0 0 12.05.7C5.79.7.7 5.79.7 12.04c0 2 .52 3.95 1.52 5.67L.6 23.3l5.73-1.5a11.33 11.33 0 0 0 5.71 1.46h.01c6.25 0 11.34-5.09 11.34-11.34 0-3.03-1.18-5.88-3.32-8.02z" />
    </svg>
  );
}

/** Who built the app and how to reach them: name, then the website and WhatsApp as icon links. */
export function DeveloperLinks({
  className,
  centered = false,
}: {
  className?: string;
  centered?: boolean;
}) {
  const t = useTranslations("developer");
  const link =
    "inline-flex items-center gap-1.5 rounded-md hover:text-foreground hover:underline";
  return (
    <div
      className={cn(
        "flex flex-col gap-1 text-xs text-muted-foreground",
        centered && "items-center text-center",
        className,
      )}
      data-testid="developer-info"
    >
      <p>
        {t("label")}:{" "}
        <span className="font-medium text-foreground">{DEVELOPER.name}</span>
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a
          href={DEVELOPER.siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={link}
          data-testid="developer-website"
        >
          <Globe className="size-3.5" aria-hidden />
          {t("website")}
        </a>
        <a
          href={DEVELOPER.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={link}
          data-testid="developer-whatsapp"
        >
          <WhatsAppIcon className="size-3.5 text-[#25D366]" />
          {t("whatsapp")}
        </a>
      </div>
    </div>
  );
}
