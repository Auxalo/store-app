import {
  Banknote,
  Boxes,
  ChartColumn,
  LayoutDashboard,
  type LucideIcon,
  Package,
  PackagePlus,
  Receipt,
  RefreshCw,
  Settings,
  ShoppingCart,
  Tags,
  Truck,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";

import type { Permission, Role } from "@/auth/permissions";
import { can } from "@/auth/permissions";

export type NavKey =
  | "dashboard"
  | "pos"
  | "products"
  | "categories"
  | "inventory"
  | "sales"
  | "purchases"
  | "returns"
  | "customers"
  | "suppliers"
  | "expenses"
  | "payments"
  | "reports"
  | "sync"
  | "settings";

export type NavGroupKey =
  | "main"
  | "catalog"
  | "transactions"
  | "people"
  | "money"
  | "system";

export interface NavItem {
  key: NavKey;
  href: `/${string}`;
  icon: LucideIcon;
  group: NavGroupKey;
  /** Plan phase in which the real screen is built (drives the placeholder text). */
  phase: number;
  /** Shown in the phone bottom bar. */
  bottom?: boolean;
}

export const navItems: readonly NavItem[] = [
  {
    key: "dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    group: "main",
    phase: 7,
    bottom: true,
  },
  {
    key: "pos",
    href: "/pos",
    icon: ShoppingCart,
    group: "main",
    phase: 4,
    bottom: true,
  },
  {
    key: "products",
    href: "/products",
    icon: Package,
    group: "catalog",
    phase: 3,
    bottom: true,
  },
  {
    key: "categories",
    href: "/categories",
    icon: Tags,
    group: "catalog",
    phase: 3,
  },
  {
    key: "inventory",
    href: "/inventory",
    icon: Boxes,
    group: "catalog",
    phase: 3,
  },
  {
    key: "sales",
    href: "/sales",
    icon: Receipt,
    group: "transactions",
    phase: 4,
    bottom: true,
  },
  {
    key: "purchases",
    href: "/purchases",
    icon: PackagePlus,
    group: "transactions",
    phase: 5,
  },
  {
    key: "returns",
    href: "/returns",
    icon: Undo2,
    group: "transactions",
    phase: 5,
  },
  {
    key: "customers",
    href: "/customers",
    icon: Users,
    group: "people",
    phase: 5,
  },
  {
    key: "suppliers",
    href: "/suppliers",
    icon: Truck,
    group: "people",
    phase: 5,
  },
  {
    key: "expenses",
    href: "/expenses",
    icon: Wallet,
    group: "money",
    phase: 5,
  },
  {
    key: "payments",
    href: "/payments",
    icon: Banknote,
    group: "money",
    phase: 5,
  },
  {
    key: "reports",
    href: "/reports",
    icon: ChartColumn,
    group: "money",
    phase: 7,
  },
  { key: "sync", href: "/sync", icon: RefreshCw, group: "system", phase: 2 },
  {
    key: "settings",
    href: "/settings",
    icon: Settings,
    group: "system",
    phase: 6,
  },
];

export const navGroups: readonly NavGroupKey[] = [
  "main",
  "catalog",
  "transactions",
  "people",
  "money",
  "system",
];

/** What a role needs to see each entry; entries not listed are open to everyone signed in. */
const NAV_PERMISSION: Partial<Record<NavKey, Permission>> = {
  dashboard: "dashboard.view",
  categories: "product.edit",
  purchases: "purchase.manage",
  returns: "sale.void",
  suppliers: "purchase.manage",
  expenses: "expense.manage",
  reports: "report.view",
  settings: "settings.manage",
};

/** The menu for a role. (Screens also check permissions themselves; this just hides dead ends.) */
export function navItemsFor(role: Role | undefined): NavItem[] {
  return navItems.filter((item) => {
    const needed = NAV_PERMISSION[item.key];
    return !needed || can(role, needed);
  });
}

/** Where a role starts: the dashboard if it may see it, otherwise the counter. */
export function homeFor(role: Role | undefined): "/dashboard" | "/pos" {
  return can(role, "dashboard.view") ? "/dashboard" : "/pos";
}

export function findNavItem(pathname: string): NavItem | undefined {
  return navItems.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
