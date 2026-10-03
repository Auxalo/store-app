export const DEFAULT_TIME_ZONE = "Asia/Dhaka";
export const DEFAULT_CURRENCY = "BDT";

/** Store setting that switches the audit log on. Off unless the owner turns it on. */
export const AUDIT_SETTING = "audit.enabled";
/** Audit rows are deleted automatically this long after they were written (TTL index). */
export const AUDIT_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/** Store setting holding when first-time setup was finished or skipped (empty until then). */
export const SETUP_SETTING = "setup.completedAt";

/** The id every platform operator account carries instead of a shop's id (see src/server/platform-admin.ts). */
export const PLATFORM_STORE_ID = "platform";
