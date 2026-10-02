"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListResult } from "@/data/hooks";

/**
 * The end of a list: more loads by itself as it scrolls into view, with a button as a fallback (and
 * for people who prefer to tap). Shows a placeholder while the next page is on its way.
 */
export function LoadMore({
  list,
  testId = "load-more",
}: {
  list: Pick<ListResult<unknown>, "hasMore" | "loadMore" | "isLoadingMore">;
  testId?: string;
}) {
  const t = useTranslations("list");
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasMore, loadMore, isLoadingMore } = list;

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && loadMore(),
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  if (!hasMore) return null;
  return (
    <div ref={sentinel} className="flex flex-col gap-2" data-testid={testId}>
      {isLoadingMore ? (
        <Skeleton className="h-14 w-full" aria-busy="true" />
      ) : null}
      <Button
        variant="outline"
        onClick={loadMore}
        disabled={isLoadingMore}
        data-testid="show-more"
      >
        {t("showMore")}
      </Button>
    </div>
  );
}

/** What to show when a list could not be loaded (for example, online with no connection). */
export function ListError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("list");
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-xl border border-destructive/40 p-4 text-center text-sm"
      data-testid="list-error"
    >
      <p>{t("error")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}
