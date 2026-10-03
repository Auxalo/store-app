import { getDb } from "@/db/server/mongo";
import { errorResponse, HttpError } from "@/server/http";
import { requirePlatformAdmin } from "@/server/platform-admin";

export const dynamic = "force-dynamic";

import { logAdminAction } from "@/server/admin-shops";
import { exportShop } from "@/server/shop-export";

/**
 * A backup file of ONE shop, streamed (a big shop never sits in memory). It holds everything of
 * that shop and nothing of any other, including password hashes: it is logged, and it must be
 * kept private. Restore it with `pnpm shop:restore`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requirePlatformAdmin(request);
    const { id } = await params;
    const db = await getDb();
    const store = await db.collection("stores").findOne({ _id: id as never });
    if (!store) throw new HttpError(404, "NOT_FOUND");
    await logAdminAction(
      db,
      admin,
      "shop.export",
      id,
      String(store.name ?? ""),
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          await exportShop(db, id, (line) => {
            controller.enqueue(encoder.encode(`${line}\n`));
          });
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="shop-${id.slice(0, 8)}-${day}.ndjson"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
