"use client";

import { useEffect } from "react";
import { installErrorReporting } from "@/lib/report-client-error";

/** Reports crashes this page does not catch itself (see /api/client-error). Shows nothing. */
export function ErrorReporter() {
  useEffect(() => installErrorReporting(), []);
  return null;
}
