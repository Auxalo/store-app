"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/auth/use-auth";
import { FullScreenLoader } from "@/components/shared/full-screen-loader";

/** Entry point: sends the user to the app or to sign-in once the session state is known. */
export default function Home() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "authenticated") router.replace("/dashboard");
    else if (auth.status === "unauthenticated") router.replace("/login");
  }, [auth.status, router]);

  return <FullScreenLoader />;
}
