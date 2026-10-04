import { useActiveUser } from "@/stores/active-user";

/** Small fetch helper for the owner's online-only admin screens. */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  code?: string;
  data?: T;
  /** The request never reached the server (offline). */
  offline?: boolean;
}

export async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    const json = (await response.json().catch(() => ({}))) as T & {
      code?: string;
    };
    // The server does not know who is working here (the PIN was entered while there was no
    // internet): ask for the PIN again, which tells it.
    if (json.code === "PIN_REQUIRED" && !useActiveUser.getState().locked)
      useActiveUser.getState().lock();
    return response.ok
      ? { ok: true, status: response.status, data: json }
      : { ok: false, status: response.status, code: json.code };
  } catch {
    return { ok: false, status: 0, offline: true };
  }
}
