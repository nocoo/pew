"use client";

import { useState, useEffect, useRef } from "react";
import {
  Globe,
  Users,
  Building2,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (re-exported for consumers)
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

/** Scope selection: global, or org/team with ID */
export interface ScopeSelection {
  type: "global" | "org" | "team";
  id?: string;
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

export const SCOPE_STORAGE_KEY = "pew:leaderboard:scope";

export function loadScopeFromStorage(): ScopeSelection | null {
  try {
    const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as ScopeSelection;
    if (parsed.type === "global" || ((parsed.type === "org" || parsed.type === "team") && parsed.id)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveScopeToStorage(scope: ScopeSelection): void {
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // Silently fail
  }
}

// ---------------------------------------------------------------------------
// Logo helpers
// ---------------------------------------------------------------------------

export function TeamLogoIcon({
  logoUrl,
  name,
  className,
}: {
  logoUrl: string | null;
  name: string;
  className?: string;
}) {
  const [error, setError] = useState(false);
  const [prevUrl, setPrevUrl] = useState(logoUrl);

  if (logoUrl !== prevUrl) {
    setPrevUrl(logoUrl);
    setError(false);
  }

  if (!logoUrl || error) {
    return <Users className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} strokeWidth={1.5} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external team logos, can't use next/image
    <img
      src={logoUrl}
      alt={name}
      className={cn("h-3.5 w-3.5 shrink-0 rounded-sm object-cover", className)}
      onError={() => setError(true)}
    />
  );
}

/** Tiny inline logo for team badges in leaderboard rows */
export function TeamLogoBadge({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [error, setError] = useState(false);
  const [prevUrl, setPrevUrl] = useState(logoUrl);

  if (logoUrl !== prevUrl) {
    setPrevUrl(logoUrl);
    setError(false);
  }

  if (!logoUrl || error) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external team logos, can't use next/image
    <img
      src={logoUrl}
      alt={name}
      className="h-2.5 w-2.5 shrink-0 rounded-[2px] object-cover"
      onError={() => setError(true)}
    />
  );
}

export function OrgLogoIcon({
  logoUrl,
  name,
  className,
}: {
  logoUrl: string | null;
  name: string;
  className?: string;
}) {
  const [error, setError] = useState(false);
  const [prevUrl, setPrevUrl] = useState(logoUrl);

  if (logoUrl !== prevUrl) {
    setPrevUrl(logoUrl);
    setError(false);
  }

  if (!logoUrl || error) {
    return <Building2 className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} strokeWidth={1.5} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external org logos, can't use next/image
    <img
      src={logoUrl}
      alt={name}
      className={cn("h-3.5 w-3.5 shrink-0 rounded-sm object-cover", className)}
      onError={() => setError(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// DropdownItem
// ---------------------------------------------------------------------------

function DropdownItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ScopeDropdown
// ---------------------------------------------------------------------------

export function ScopeDropdown({
  value,
  onChange,
  organizations,
  teams,
}: {
  value: ScopeSelection;
  onChange: (v: ScopeSelection) => void;
  organizations: Organization[];
  teams: Team[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const iconClass = "h-3.5 w-3.5 shrink-0 text-muted-foreground";

  // Find selected item
  const selectedOrg = value.type === "org" ? organizations.find((o) => o.id === value.id) : null;
  const selectedTeam = value.type === "team" ? teams.find((t) => t.id === value.id) : null;
  const label = value.type === "global" ? "Global" : selectedOrg?.name ?? selectedTeam?.name ?? "Global";

  const labelIcon =
    value.type === "global" ? (
      <Globe className={iconClass} strokeWidth={1.5} />
    ) : selectedOrg ? (
      <OrgLogoIcon logoUrl={selectedOrg.logoUrl} name={selectedOrg.name} />
    ) : selectedTeam ? (
      <TeamLogoIcon logoUrl={selectedTeam.logo_url} name={selectedTeam.name} />
    ) : (
      <Globe className={iconClass} strokeWidth={1.5} />
    );

  // Hide dropdown if no orgs or teams
  if (organizations.length === 0 && teams.length === 0) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg bg-secondary px-3 py-[10px] text-sm font-medium transition-colors",
          "text-foreground hover:bg-accent",
        )}
      >
        {labelIcon}
        {label}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] max-h-[320px] overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-lg">
          {/* Global option */}
          <DropdownItem
            active={value.type === "global"}
            onClick={() => {
              onChange({ type: "global" });
              setOpen(false);
            }}
          >
            <Globe className={iconClass} strokeWidth={1.5} />
            Global
          </DropdownItem>

          {/* Organizations group */}
          {organizations.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                Organizations
              </div>
              {organizations.map((org) => (
                <DropdownItem
                  key={org.id}
                  active={value.type === "org" && value.id === org.id}
                  onClick={() => {
                    onChange({ type: "org", id: org.id });
                    setOpen(false);
                  }}
                >
                  <OrgLogoIcon logoUrl={org.logoUrl} name={org.name} />
                  {org.name}
                </DropdownItem>
              ))}
            </>
          )}

          {/* Teams group */}
          {teams.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
                Teams
              </div>
              {teams.map((team) => (
                <DropdownItem
                  key={team.id}
                  active={value.type === "team" && value.id === team.id}
                  onClick={() => {
                    onChange({ type: "team", id: team.id });
                    setOpen(false);
                  }}
                >
                  <TeamLogoIcon logoUrl={team.logo_url} name={team.name} />
                  {team.name}
                </DropdownItem>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
