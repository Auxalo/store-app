"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { ProfileProvider, useAuth } from "@/auth/use-auth";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";
import { SyncProvider } from "./sync-provider";

/** Client-side route guard (pages are static so they work offline; the server guards the APIs). */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "unauthenticated") router.replace("/login");
  }, [auth.status, router]);

  if (auth.status !== "authenticated") return <FullScreenLoader />;
  return (
    <ProfileProvider profile={auth.profile}>
      <SyncProvider>{children}</SyncProvider>
    </ProfileProvider>
  );
}
