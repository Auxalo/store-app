import { errorCode } from "@/data/errors";

/**
 * The reason code of a refused command, from the server (online) or from the device (offline,
 * where errors read like "CONFLICT:HAS_RETURNS" or "NOT_FOUND:return").
 */
export function refusalCode(error: unknown): string {
  const online = errorCode(error);
  if (online !== "UNKNOWN") return online;
  const message = error instanceof Error ? error.message : "";
  const [head, tail] = message.split(":");
  if (head === "CONFLICT" && tail) return tail;
  if (head === "NOT_FOUND") return "NOT_FOUND";
  if (head === "ALREADY_EXISTS") return "ALREADY_DONE";
  return head || "UNKNOWN";
}
