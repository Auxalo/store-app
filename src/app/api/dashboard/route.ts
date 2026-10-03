import { NextResponse } from "next/server";
import { z } from "zod";
import { can } from "@/auth/permissions";
import { parseListParams } from "@/data/spec";
import { presetRange } from "@/reports/ranges";
import { requireActor } from "@/server/actor-request";
import { listResource, storeTimeZone, totalsOf } from "@/server/data/service";
import { getSyncDeps } from "@/server/deps";
import { errorResponse } from "@/server/http";
import { hideProfit, serverSummaryCached } from "@/server/reports";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  days: z.enum(["days7", "days30"]).default("days7"),
});

/**
 * Everything the dashboard shows, in ONE request (it used to be seven): today, yesterday and the
 * trend, what customers owe and what the shop owes, what is running low, and the latest sales.
 * The pieces are asked of the database at the same time.
 */
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request, "dashboard.view");
    const { days } = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const { db } = await getSyncDeps();
    const timeZone = await storeTimeZone(db, actor.storeId);
    const viewer = {
      storeId: actor.storeId,
      canSeeCost: can(actor.role, "purchasePrice.view"),
      timeZone,
    };
    const summary = (preset: "today" | "yesterday" | "days7" | "days30") =>
      serverSummaryCached(
        db,
        actor.storeId,
        presetRange(preset, timeZone),
        timeZone,
      );

    const [today, yesterday, trend, customers, suppliers, low, recent] =
      await Promise.all([
        summary("today"),
        summary("yesterday"),
        summary(days),
        totalsOf(
          db,
          "customers",
          parseListParams("customers", { balance: "owes" }),
          viewer,
        ),
        can(actor.role, "purchase.manage")
          ? totalsOf(
              db,
              "suppliers",
              parseListParams("suppliers", { balance: "owes" }),
              viewer,
            )
          : Promise.resolve({ owed: 0 } as Record<string, number>),
        listResource(
          db,
          "products",
          parseListParams("products", {
            stock: "low",
            active: "active",
            sort: "stock",
          }),
          viewer,
          { limit: 6 },
        ),
        listResource(
          db,
          "sales",
          parseListParams("sales", { status: "active", sort: "newest" }),
          viewer,
          { limit: 6 },
        ),
      ]);

    const seeProfit = can(actor.role, "profit.view");
    const shown = (s: typeof today) => (seeProfit ? s : hideProfit(s));
    return NextResponse.json({
      today: shown(today),
      yesterday: shown(yesterday),
      trend: shown(trend),
      customerOwed: customers.owed ?? 0,
      supplierOwed: suppliers.owed ?? 0,
      low: low.items,
      recent: recent.items,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
