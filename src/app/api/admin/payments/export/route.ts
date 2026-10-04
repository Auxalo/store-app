import { getDb } from "@/db/server/mongo";
import { paymentsQuery } from "@/schemas/billing";
import { listPayments, paymentsCsv } from "@/server/admin-billing";
import { logAdminAction } from "@/server/admin-shops";
import { errorResponse } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

/** The payments as a CSV file, for the operator's accounts. */
export async function GET(request: Request) {
  try {
    const admin = await requirePlatformAdmin(request);
    const query = paymentsQuery.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const db = await getDb();
    const rows = await listPayments(db, { ...query, limit: 2000 });
    await logAdminAction(
      db,
      admin,
      "payments.export",
      null,
      `${rows.length} row(s)${query.month ? ` ${query.month}` : ""}${query.status ? ` ${query.status}` : ""}`,
    );
    const name = `payments-${query.month ?? new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(paymentsCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
