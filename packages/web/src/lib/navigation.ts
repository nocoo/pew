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
  /** When true, opens in new tab with <a> instead of <Link> */
  external?: boolean;
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
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/leaderboard", label: "Leaderboard", icon: "Trophy", external: true },
    ],
  },
  {
    label: "Analytics",
    defaultOpen: true,
    items: [
      { href: "/hourly-usage", label: "Hourly Usage", icon: "Clock" },
      { href: "/daily-usage", label: "Daily Usage", icon: "CalendarDays" },
      { href: "/sessions", label: "Sessions", icon: "MessagesSquare" },
      { href: "/projects", label: "Projects", icon: "FolderGit2" },
      { href: "/agents", label: "By Agent", icon: "AppWindow" },
      { href: "/models", label: "By Model", icon: "Cpu" },
      { href: "/devices", label: "By Device", icon: "Monitor" },
    ],
  },
  {
    label: "Settings",
    defaultOpen: true,
    items: [
      { href: "/teams", label: "Teams", icon: "Users" },
      { href: "/manage-projects", label: "Projects", icon: "FolderKanban" },
      { href: "/manage-devices", label: "Devices", icon: "MonitorSmartphone" },
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
    { href: "/admin/seasons", label: "Seasons", icon: "Trophy" },
    { href: "/admin/storage", label: "Storage", icon: "Database" },
  ],
};

export function getNavGroups(isAdmin: boolean): NavGroupDef[] {
  return isAdmin ? [...BASE_NAV_GROUPS, ADMIN_NAV_GROUP] : BASE_NAV_GROUPS;
}

// ---------------------------------------------------------------------------
// Route labels (used for breadcrumbs in app-shell)
// ---------------------------------------------------------------------------

export const ROUTE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  settings: "General",
  teams: "Teams",
  projects: "Projects",
  "manage-projects": "Projects",
  "hourly-usage": "Hourly Usage",
  "daily-usage": "Daily Usage",
  agents: "By Agent",
  models: "By Model",
  devices: "By Device",
  "manage-devices": "Devices",
  leaderboard: "Leaderboard",
  seasons: "Seasons",
  storage: "Storage",
};

export function breadcrumbsFromPathname(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const items: { label: string; href?: string }[] = [{ label: "Home", href: "/dashboard" }];

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
