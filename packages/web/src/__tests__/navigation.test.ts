import { describe, it, expect } from "vitest";
import {
  BASE_NAV_GROUPS,
  ADMIN_NAV_GROUP,
  getNavGroups,
  ROUTE_LABELS,
  breadcrumbsFromPathname,
} from "@/lib/navigation";

// ---------------------------------------------------------------------------
// Sidebar navigation structure
// ---------------------------------------------------------------------------

describe("sidebar navigation", () => {
  describe("BASE_NAV_GROUPS", () => {
    it("should have three groups: Overview, Analytics, Settings", () => {
      const labels = BASE_NAV_GROUPS.map((g) => g.label);
      expect(labels).toEqual(["Overview", "Analytics", "Settings"]);
    });

    it("should not have a group called Account", () => {
      const labels = BASE_NAV_GROUPS.map((g) => g.label);
      expect(labels).not.toContain("Account");
    });

    it("Settings group should contain Teams, Projects, Devices, then General", () => {
      const settingsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Settings");
      expect(settingsGroup).toBeDefined();
      const items = settingsGroup!.items.map((i) => i.label);
      expect(items).toEqual(["Teams", "Projects", "Devices", "General"]);
    });

    it("Teams should link to /teams", () => {
      const settingsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Settings")!;
      const teamsItem = settingsGroup.items.find((i) => i.label === "Teams");
      expect(teamsItem).toBeDefined();
      expect(teamsItem!.href).toBe("/teams");
    });

    it("General should link to /settings", () => {
      const settingsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Settings")!;
      const generalItem = settingsGroup.items.find((i) => i.label === "General");
      expect(generalItem).toBeDefined();
      expect(generalItem!.href).toBe("/settings");
    });

    it("should contain all expected nav items across groups", () => {
      const allHrefs = BASE_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
      expect(allHrefs).toContain("/dashboard");
      expect(allHrefs).toContain("/leaderboard");
      expect(allHrefs).toContain("/hourly-usage");
      expect(allHrefs).toContain("/daily-usage");
      expect(allHrefs).toContain("/sessions");
      expect(allHrefs).toContain("/agents");
      expect(allHrefs).toContain("/models");
      expect(allHrefs).toContain("/devices");
      expect(allHrefs).toContain("/projects");
      expect(allHrefs).toContain("/teams");
      expect(allHrefs).toContain("/manage-projects");
      expect(allHrefs).toContain("/manage-devices");
      expect(allHrefs).toContain("/settings");
    });

    it("should mark leaderboard as external", () => {
      const overviewGroup = BASE_NAV_GROUPS.find((g) => g.label === "Overview")!;
      const leaderboard = overviewGroup.items.find((i) => i.label === "Leaderboard");
      expect(leaderboard).toBeDefined();
      expect(leaderboard!.external).toBe(true);
    });

    it("should not mark other items as external", () => {
      const nonExternal = BASE_NAV_GROUPS.flatMap((g) => g.items).filter(
        (i) => i.label !== "Leaderboard"
      );
      for (const item of nonExternal) {
        expect(item.external).toBeUndefined();
      }
    });

    it("should have no duplicate hrefs", () => {
      const allHrefs = BASE_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
      expect(new Set(allHrefs).size).toBe(allHrefs.length);
    });

    // Device navigation entries
    it("Analytics group should include By Device after By Model", () => {
      const analyticsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Analytics")!;
      const items = analyticsGroup.items.map((i) => i.label);
      const modelIdx = items.indexOf("By Model");
      const deviceIdx = items.indexOf("By Device");
      expect(deviceIdx).toBeGreaterThan(-1);
      expect(deviceIdx).toBe(modelIdx + 1);
    });

    it("By Device should link to /devices with Monitor icon", () => {
      const analyticsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Analytics")!;
      const byDevice = analyticsGroup.items.find((i) => i.label === "By Device");
      expect(byDevice).toBeDefined();
      expect(byDevice!.href).toBe("/devices");
      expect(byDevice!.icon).toBe("Monitor");
    });

    it("Analytics group should include Projects after Sessions", () => {
      const analyticsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Analytics")!;
      const items = analyticsGroup.items.map((i) => i.label);
      const sessionsIdx = items.indexOf("Sessions");
      const projectIdx = items.indexOf("Projects");
      expect(projectIdx).toBeGreaterThan(-1);
      expect(projectIdx).toBe(sessionsIdx + 1);
    });

    it("Projects should link to /projects with FolderGit2 icon", () => {
      const analyticsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Analytics")!;
      const projects = analyticsGroup.items.find((i) => i.label === "Projects" && i.icon === "FolderGit2");
      expect(projects).toBeDefined();
      expect(projects!.href).toBe("/projects");
    });

    it("Settings group Projects should link to /manage-projects with FolderKanban icon", () => {
      const settingsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Settings")!;
      const projects = settingsGroup.items.find((i) => i.label === "Projects");
      expect(projects).toBeDefined();
      expect(projects!.href).toBe("/manage-projects");
      expect(projects!.icon).toBe("FolderKanban");
    });

    it("Settings group should include Devices after Projects", () => {
      const settingsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Settings")!;
      const items = settingsGroup.items.map((i) => i.label);
      const projectsIdx = items.indexOf("Projects");
      const devicesIdx = items.indexOf("Devices");
      expect(devicesIdx).toBeGreaterThan(-1);
      expect(devicesIdx).toBe(projectsIdx + 1);
    });

    it("Devices should link to /manage-devices with MonitorSmartphone icon", () => {
      const settingsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Settings")!;
      const devices = settingsGroup.items.find((i) => i.label === "Devices");
      expect(devices).toBeDefined();
      expect(devices!.href).toBe("/manage-devices");
      expect(devices!.icon).toBe("MonitorSmartphone");
    });
  });

  describe("getNavGroups", () => {
    it("should return base groups for non-admin users", () => {
      const groups = getNavGroups(false);
      expect(groups).toEqual(BASE_NAV_GROUPS);
      expect(groups).toHaveLength(3);
    });

    it("should append Admin group for admin users", () => {
      const groups = getNavGroups(true);
      expect(groups).toHaveLength(4);
      expect(groups[3]!.label).toBe("Admin");
      expect(groups[3]).toEqual(ADMIN_NAV_GROUP);
    });
  });
  describe("ADMIN_NAV_GROUP", () => {
    it("should include Invite Codes nav item", () => {
      const items = ADMIN_NAV_GROUP.items.map((i) => i.label);
      expect(items).toContain("Invite Codes");
    });

    it("should link Invite Codes to /admin/invites", () => {
      const inviteItem = ADMIN_NAV_GROUP.items.find(
        (i) => i.label === "Invite Codes"
      );
      expect(inviteItem).toBeDefined();
      expect(inviteItem!.href).toBe("/admin/invites");
      expect(inviteItem!.icon).toBe("Ticket");
    });

    it("should include Storage nav item", () => {
      const storageItem = ADMIN_NAV_GROUP.items.find(
        (i) => i.label === "Storage"
      );
      expect(storageItem).toBeDefined();
      expect(storageItem!.href).toBe("/admin/storage");
      expect(storageItem!.icon).toBe("Database");
    });
  });
});

// ---------------------------------------------------------------------------
// Route labels & breadcrumbs
// ---------------------------------------------------------------------------

describe("route labels", () => {
  it("should map settings to General", () => {
    expect(ROUTE_LABELS["settings"]).toBe("General");
  });

  it("should map teams to Teams", () => {
    expect(ROUTE_LABELS["teams"]).toBe("Teams");
  });

  it("should map devices to By Device", () => {
    expect(ROUTE_LABELS["devices"]).toBe("By Device");
  });

  it("should map manage-devices to Devices", () => {
    expect(ROUTE_LABELS["manage-devices"]).toBe("Devices");
  });

  it("should include all expected routes", () => {
    expect(ROUTE_LABELS).toEqual({
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
    });
  });
});

describe("breadcrumbsFromPathname", () => {
  it("should return Home for root path", () => {
    expect(breadcrumbsFromPathname("/")).toEqual([{ label: "Home", href: "/dashboard" }]);
  });

  it("should return breadcrumbs for /settings", () => {
    const crumbs = breadcrumbsFromPathname("/settings");
    expect(crumbs).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "General" },
    ]);
  });

  it("should return breadcrumbs for /teams", () => {
    const crumbs = breadcrumbsFromPathname("/teams");
    expect(crumbs).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Teams" },
    ]);
  });

  it("should return breadcrumbs for nested routes", () => {
    const crumbs = breadcrumbsFromPathname("/admin/pricing");
    expect(crumbs).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "admin", href: "/admin" },
      { label: "pricing" },
    ]);
  });

  it("should use route label for known segments", () => {
    const crumbs = breadcrumbsFromPathname("/daily-usage");
    expect(crumbs).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Daily Usage" },
    ]);
  });

  it("should truncate unknown segment labels to 8 chars", () => {
    const crumbs = breadcrumbsFromPathname("/longersegmentname");
    expect(crumbs[1]!.label).toBe("longerse");
  });

  it("should return breadcrumbs for /devices", () => {
    const crumbs = breadcrumbsFromPathname("/devices");
    expect(crumbs).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "By Device" },
    ]);
  });

  it("should return breadcrumbs for /manage-devices", () => {
    const crumbs = breadcrumbsFromPathname("/manage-devices");
    expect(crumbs).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Devices" },
    ]);
  });

  it("should return breadcrumbs for /manage-projects", () => {
    const crumbs = breadcrumbsFromPathname("/manage-projects");
    expect(crumbs).toEqual([
      { label: "Home", href: "/dashboard" },
      { label: "Projects" },
    ]);
  });
});
