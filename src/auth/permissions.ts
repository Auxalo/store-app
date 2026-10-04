/**
 * Roles and permissions, shared by the UI (hide/disable) and the server (enforce).
 * Offline the UI checks a cached copy; the server re-checks every pushed operation.
 */
export const ROLES = ["owner", "manager", "cashier"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "dashboard.view",
  "sale.create",
  "sale.priceOverride",
  "sale.void",
  "product.create",
  "opening.manage",
  "product.edit",
  "purchasePrice.view",
  "stock.adjust",
  "purchase.manage",
  "expense.manage",
  "profit.view",
  "report.view",
  "user.manage",
  "settings.manage",
  "mode.switch",
  "billing.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const MANAGER: readonly Permission[] = PERMISSIONS.filter(
  (p) => p !== "user.manage" && p !== "settings.manage",
);

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: MANAGER,
  cashier: ["sale.create"],
};

export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" && (ROLES as readonly string[]).includes(value)
  );
}

export function can(role: Role | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}
