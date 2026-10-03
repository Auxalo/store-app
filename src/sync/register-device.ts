import type { StoreDB } from "@/db/local/db";
import { getDeviceId, setMeta } from "@/db/local/meta";
import { TransportError } from "./transport";

function deviceName(): string {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return (nav.userAgentData?.platform || nav.platform || "Browser").slice(
    0,
    60,
  );
}

let inFlight: Promise<string> | undefined;

/**
 * Tells the server this browser is a device of the shop (it then gets a device cookie and a short
 * code). Used by the sync manager and by online screens whose first request can come before the
 * manager's first cycle; two callers at once share one request.
 */
export function registerDevice(db: StoreDB): Promise<string> {
  inFlight ??= (async () => {
    const deviceId = await getDeviceId(db);
    let response: Response;
    try {
      response = await fetch("/api/devices/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId, name: deviceName() }),
      });
    } catch {
      throw new TransportError("network");
    }
    if (response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      if (body.code === "SHOP_SUSPENDED")
        throw new TransportError("suspended", body.code, 403);
    }
    if (response.status === 401 || response.status === 403)
      throw new TransportError("auth");
    if (!response.ok) throw new TransportError("server");
    const { code } = (await response.json()) as { code: string };
    await setMeta(db, "deviceCode", code);
    return code;
  })().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
