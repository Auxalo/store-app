"use client";

import { useRecord } from "@/data/hooks";
import type { ReturnDoc } from "@/db/local/types";
import { VoidReturnDialog } from "./void-return-dialog";

/** The cancel-return window for a return known only by its id (a line of a statement). */
export function VoidReturnById({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const loaded = useRecord("returns", id);
  const ret =
    id && loaded.record ? (loaded.record as unknown as ReturnDoc) : null;
  return <VoidReturnDialog ret={ret} onClose={onClose} />;
}
