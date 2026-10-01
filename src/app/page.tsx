"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/auth/use-auth";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";
import { homeFor } from "@/config/nav";

/** Entry point: sends the user to the app or to sign-in once the session state is known. */
export default function Home() {
  const auth = useAuth();
  const router = useRouter();

  const role = auth.status === "authenticated" ? auth.profile.role : undefined;

  useEffect(() => {
    if (auth.status === "authenticated") router.replace(homeFor(role));
    else if (auth.status === "unauthenticated") router.replace("/login");
  }, [auth.status, role, router]);

  return <FullScreenLoader />;
}
