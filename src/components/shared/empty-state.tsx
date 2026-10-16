import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * What a list says when it has nothing to show: a soft icon, the message, and (when there is a
 * sensible next step) a button for it, so an empty screen is never a dead end.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
  testId,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-4 py-10 text-center",
        className,
      )}
      data-testid={testId}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {hint ? (
        <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
