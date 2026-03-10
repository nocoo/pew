/**
 * Navigation configuration for the dashboard.
 *
 * Pure data — no React dependency.
 * Imported by sidebar.tsx (adds icons) and tests.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavItemDef {
  href: string;
  label: string;
  /** Lucide icon name for lookup in sidebar.tsx */
  icon: string;
}

export interface NavGroupDef {
  label: string;
  items: NavItemDef[];
  defaultOpen?: boolean;
}

// ---------------------------------------------------------------------------
// Navigation groups
// ---------------------------------------------------------------------------

export const BASE_NAV_GROUPS: NavGroupDef[] = [
  {
    label: "Overview",
    defaultOpen: true,
    items: [
      { href: "/", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/leaderboard", label: "Leaderboard", icon: "Trophy" },
    ],
  },
  {
    label: "Analytics",
    defaultOpen: true,
    items: [
      { href: "/details", label: "Daily Usage", icon: "CalendarDays" },
      { href: "/sessions", label: "Sessions", icon: "MessagesSquare" },
      { href: "/apps", label: "By App", icon: "AppWindow" },
      { href: "/models", label: "By Model", icon: "Cpu" },
    ],
  },
  {
    label: "Settings",
    defaultOpen: true,
    items: [
      { href: "/teams", label: "Teams", icon: "Users" },
      { href: "/settings", label: "General", icon: "Settings" },
    ],
  },
];

export const ADMIN_NAV_GROUP: NavGroupDef = {
  label: "Admin",
  defaultOpen: true,
  items: [
    { href: "/admin/pricing", label: "Token Pricing", icon: "DollarSign" },
    { href: "/admin/invites", label: "Invite Codes", icon: "Ticket" },
  ],
};

export function getNavGroups(isAdmin: boolean): NavGroupDef[] {
  return isAdmin ? [...BASE_NAV_GROUPS, ADMIN_NAV_GROUP] : BASE_NAV_GROUPS;
}

// ---------------------------------------------------------------------------
// Route labels (used for breadcrumbs in app-shell)
// ---------------------------------------------------------------------------

export const ROUTE_LABELS: Record<string, string> = {
  settings: "General",
  teams: "Teams",
  details: "Daily Usage",
  apps: "By App",
  models: "By Model",
  leaderboard: "Leaderboard",
};

export function breadcrumbsFromPathname(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const items: { label: string; href?: string }[] = [{ label: "Home", href: "/" }];

  let href = "";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    href += `/${seg}`;
    const isLast = i === segments.length - 1;
    const label = ROUTE_LABELS[seg] ?? seg.slice(0, 8);
    items.push(isLast ? { label } : { label, href });
  }

  return items;
}
