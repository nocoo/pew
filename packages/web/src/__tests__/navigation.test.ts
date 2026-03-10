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

    it("Settings group should contain Teams before General", () => {
      const settingsGroup = BASE_NAV_GROUPS.find((g) => g.label === "Settings");
      expect(settingsGroup).toBeDefined();
      const items = settingsGroup!.items.map((i) => i.label);
      expect(items).toEqual(["Teams", "General"]);
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
      expect(allHrefs).toContain("/");
      expect(allHrefs).toContain("/leaderboard");
      expect(allHrefs).toContain("/details");
      expect(allHrefs).toContain("/sessions");
      expect(allHrefs).toContain("/apps");
      expect(allHrefs).toContain("/models");
      expect(allHrefs).toContain("/teams");
      expect(allHrefs).toContain("/settings");
    });

    it("should have no duplicate hrefs", () => {
      const allHrefs = BASE_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
      expect(new Set(allHrefs).size).toBe(allHrefs.length);
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

  it("should include all expected routes", () => {
    expect(ROUTE_LABELS).toEqual({
      settings: "General",
      teams: "Teams",
      details: "Daily Usage",
      apps: "By App",
      models: "By Model",
      leaderboard: "Leaderboard",
    });
  });
});

describe("breadcrumbsFromPathname", () => {
  it("should return Home for root path", () => {
    expect(breadcrumbsFromPathname("/")).toEqual([{ label: "Home", href: "/" }]);
  });

  it("should return breadcrumbs for /settings", () => {
    const crumbs = breadcrumbsFromPathname("/settings");
    expect(crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "General" },
    ]);
  });

  it("should return breadcrumbs for /teams", () => {
    const crumbs = breadcrumbsFromPathname("/teams");
    expect(crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "Teams" },
    ]);
  });

  it("should return breadcrumbs for nested routes", () => {
    const crumbs = breadcrumbsFromPathname("/admin/pricing");
    expect(crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "admin", href: "/admin" },
      { label: "pricing" },
    ]);
  });

  it("should use route label for known segments", () => {
    const crumbs = breadcrumbsFromPathname("/details");
    expect(crumbs).toEqual([
      { label: "Home", href: "/" },
      { label: "Daily Usage" },
    ]);
  });

  it("should truncate unknown segment labels to 8 chars", () => {
    const crumbs = breadcrumbsFromPathname("/longersegmentname");
    expect(crumbs[1]!.label).toBe("longerse");
  });
});
