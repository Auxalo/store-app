"use client";

import { useQuery } from "@tanstack/react-query";
import type { Product, Sale } from "@/db/local/types";
import type { Summary } from "@/reports/compute";
import { DataError } from "./errors";

export interface DashboardData {
  today: Summary;
  yesterday: Summary;
  trend: Summary;
  customerOwed: number;
  supplierOwed: number;
  low: Product[];
  recent: Sale[];
}

/**
 * The whole dashboard in one request (online mode). Seven separate questions made the first screen
 * wait on seven round trips; this is one, and the server asks the database for the pieces together.
 */
export function useOnlineDashboard(enabled: boolean, days: "days7" | "days30") {
  return useQuery({
    queryKey: ["data", "dashboard", days],
    enabled,
    queryFn: async ({ signal }): Promise<DashboardData> => {
      let response: Response;
      try {
        response = await fetch(`/api/dashboard?days=${days}`, {
          credentials: "same-origin",
          signal,
        });
      } catch {
        throw new DataError("OFFLINE", 0);
      }
      if (!response.ok)
        throw new DataError(`HTTP_${response.status}`, response.status);
      return (await response.json()) as DashboardData;
    },
  });
}
