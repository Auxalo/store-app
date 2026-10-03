import type { ReactNode } from "react";

/** The operator panel stands apart from the shop app: no shop, no sync, no sidebar. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center justify-between border-b pb-3">
        <h1 className="text-lg font-semibold">Operator panel</h1>
        <span className="text-xs text-muted-foreground">
          Not visible to shops
        </span>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
