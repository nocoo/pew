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
      { href: "/devices", label: "By Device", icon: "Monitor" },
      { href: "/agents", label: "By Agent", icon: "AppWindow" },
      { href: "/models", label: "By Model", icon: "Cpu" },
      { href: "/projects", label: "By Project", icon: "FolderGit2" },
      { href: "/model-prices", label: "Model Prices", icon: "Tag" },
    ],
  },
  {
    label: "Settings",
    defaultOpen: true,
    items: [
      { href: "/teams", label: "Teams", icon: "Users" },
      { href: "/manage-projects", label: "Projects", icon: "FolderKanban" },
      { href: "/manage-devices", label: "Devices", icon: "MonitorSmartphone" },
      { href: "/settings/organizations", label: "Organizations", icon: "Building2" },
      { href: "/settings/showcases", label: "Showcases", icon: "Star" },
      { href: "/settings/general", label: "General", icon: "Settings" },
    ],
  },
];

export const ADMIN_NAV_GROUP: NavGroupDef = {
  label: "Admin",
  defaultOpen: true,
  items: [
    { href: "/admin/invites", label: "Invite Codes", icon: "Ticket" },
    { href: "/admin/organizations", label: "Organizations", icon: "Building2" },
    { href: "/admin/seasons", label: "Seasons", icon: "Trophy" },
    { href: "/admin/badges", label: "Badges", icon: "Medal" },
    { href: "/admin/showcases", label: "Showcases", icon: "Star" },
    { href: "/admin/storage", label: "Storage", icon: "Database" },
    { href: "/admin/compare", label: "Compare Users", icon: "GitCompareArrows" },
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
  settings: "Settings",
  general: "General",
  teams: "Teams",
  projects: "By Project",
  "manage-projects": "Projects",
  "hourly-usage": "Hourly Usage",
  "daily-usage": "Daily Usage",
  agents: "By Agent",
  models: "By Model",
  devices: "By Device",
  "manage-devices": "Devices",
  leaderboard: "Leaderboard",
  showcases: "Showcases",
  organizations: "Organizations",
  admin: "Admin",
  seasons: "Seasons",
  badges: "Badges",
  storage: "Storage",
  "model-prices": "Model Prices",
  invites: "Invite Codes",
  compare: "Compare Users",
  result: "Results",
};

/**
 * Segments that act as non-navigable group prefixes.
 * They appear in breadcrumbs as plain text (no link) even when
 * they are not the last segment.
 */
const NON_NAVIGABLE_SEGMENTS = new Set(["admin"]);

export function breadcrumbsFromPathname(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const items: { label: string; href?: string }[] = [{ label: "Home", href: "/dashboard" }];

  let href = "";
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] as string;
    href += `/${seg}`;
    const isLast = i === segments.length - 1;
    const label = ROUTE_LABELS[seg] ?? seg.slice(0, 8);
    const nonNavigable = NON_NAVIGABLE_SEGMENTS.has(seg);
    items.push(isLast || nonNavigable ? { label } : { label, href });
  }

  return items;
}
