"use client";

import { Languages, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { signOut, useProfile } from "@/auth/use-auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NumeralSystem } from "@/lib/format";
import { usePreferences } from "@/stores/preferences";
import { InstallAppMenuItem } from "./install-app";

export function UserMenu() {
  const t = useTranslations();
  const router = useRouter();
  const profile = useProfile();
  const { theme = "system", setTheme } = useTheme();
  const numerals = usePreferences((s) => s.numerals);
  const setNumerals = usePreferences((s) => s.setNumerals);

  const initial = profile.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={t("common.account")}
        >
          <Avatar className="size-8">
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{profile.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {t(`role.${profile.role}`)}
            {profile.storeName ? ` · ${profile.storeName}` : ""}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun aria-hidden />
            {t("common.theme")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="light">
                <Sun aria-hidden />
                {t("common.themeLight")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon aria-hidden />
                {t("common.themeDark")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor aria-hidden />
                {t("common.themeSystem")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages aria-hidden />
            {t("common.numerals")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={numerals}
              onValueChange={(v) => setNumerals(v as NumeralSystem)}
            >
              <DropdownMenuRadioItem value="auto">
                {t("common.numeralsAuto")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="latn">
                {t("common.numeralsLatn")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="beng">
                {t("common.numeralsBeng")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <InstallAppMenuItem />

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={async () => {
            await signOut();
            router.replace("/login");
          }}
        >
          <LogOut aria-hidden />
          {t("common.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
