import { Loader2 } from "lucide-react";

export function FullScreenLoader() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center"
      role="status"
      aria-busy="true"
    >
      <Loader2
        className="size-6 animate-spin text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}
