/** Version of this build, injected from package.json by next.config.ts. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

/**
 * Oldest client the server still accepts operations from. Raise it only together with a change
 * that makes older queued operations unreadable (the client keeps its queue and asks to update).
 */
export const MIN_APP_VERSION = "0.1.0";
