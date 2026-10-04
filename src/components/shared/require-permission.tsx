"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { can, type Permission } from "@/auth/permissions";
import { useProfile } from "@/auth/use-auth";

/**
 * Shows the screen only to a role that may use it. The menu already hides what a role may not
 * open; this covers someone typing the address (the server refuses the data too).
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const t = useTranslations("products");
  const { role } = useProfile();
  if (!can(role, permission)) {
    return (
      <p
        className="py-10 text-center text-sm text-muted-foreground"
        data-testid="no-access"
      >
        {t("noAccess")}
      </p>
    );
  }
  return children;
}
