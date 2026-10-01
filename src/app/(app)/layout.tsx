import { AppShell } from "@/components/layout/app-shell";
import { AuthGate } from "@/components/layout/auth-gate";

// Every page under (app) is a static client page that reads from the device database, so the
// service worker can precache it and it opens offline. Never fetch server data during render here.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
