"use client";

import { useState, useRef, useCallback } from "react";
import {
  Globe,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { TeamLogoIcon, OrgLogoIcon } from "@/components/leaderboard/logo-icons";
import type { ScopeSelection, Organization, Team } from "@/lib/leaderboard-scope";

// Re-export for existing consumers
export type { ScopeSelection, Organization, Team } from "@/lib/leaderboard-scope";
export { loadScopeFromStorage, saveScopeToStorage, SCOPE_STORAGE_KEY } from "@/lib/leaderboard-scope";

// ---------------------------------------------------------------------------
// DropdownItem
// ---------------------------------------------------------------------------

function DropdownItem({
  active,
  onClick,
  children,
  id,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <div
      role="option"
      id={id}
      aria-selected={active}
      tabIndex={-1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </div>
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
  const listboxRef = useRef<HTMLDivElement>(null);

  const iconClass = "h-3.5 w-3.5 shrink-0 text-muted-foreground";

  // Determine which option is currently selected
  const activeId = value.type === "global"
    ? "scope-global"
    : value.type === "org"
      ? `scope-org-${value.id}`
      : `scope-team-${value.id}`;

  // Roving focus: arrow keys move focus among [role="option"] elements
  const handleListboxKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const container = listboxRef.current;
      if (!container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>('[role="option"]'),
      );
      if (items.length === 0) return;

      const current = document.activeElement as HTMLElement;
      const idx = items.indexOf(current);

      let next: HTMLElement | undefined;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          next = items[(idx + 1) % items.length];
          break;
        case "ArrowUp":
          e.preventDefault();
          next = items[(idx - 1 + items.length) % items.length];
          break;
        case "Home":
          e.preventDefault();
          next = items[0];
          break;
        case "End":
          e.preventDefault();
          next = items[items.length - 1];
          break;
      }
      next?.focus();
    },
    [],
  );

  // Auto-focus the selected option (or first) when popover opens
  const handleOpenAutoFocus = useCallback(
    (e: Event) => {
      e.preventDefault(); // prevent Radix from focusing the content wrapper
      const container = listboxRef.current;
      if (!container) return;
      const target =
        container.querySelector<HTMLElement>(`#${CSS.escape(activeId)}`) ??
        container.querySelector<HTMLElement>('[role="option"]');
      target?.focus();
    },
    [activeId],
  );

  // Find selected item for trigger label
  const selectedOrg = value.type === "org" ? organizations.find((o) => o.id === value.id) : null;
  const selectedTeam = value.type === "team" ? teams.find((t) => t.id === value.id) : null;
  const label = value.type === "global" ? "Global" : selectedOrg?.name ?? selectedTeam?.name ?? "Global";

  const labelIcon =
    value.type === "global" ? (
      <Globe className={iconClass} strokeWidth={1.5} />
    ) : selectedOrg ? (
      <OrgLogoIcon logoUrl={selectedOrg.logoUrl} name={selectedOrg.name} />
    ) : selectedTeam ? (
      <TeamLogoIcon logoUrl={selectedTeam.logoUrl} name={selectedTeam.name} />
    ) : (
      <Globe className={iconClass} strokeWidth={1.5} />
    );

  // Hide dropdown if no orgs or teams
  if (organizations.length === 0 && teams.length === 0) return null;

  const select = (scope: ScopeSelection) => {
    onChange(scope);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="scope-listbox"
          className={cn(
            "flex items-center gap-2 rounded-lg bg-secondary px-3 py-2.5 text-sm font-medium transition-colors",
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
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="min-w-[180px] max-h-[320px] overflow-y-auto p-1"
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        {/* Roving focus: real DOM focus moves to options, no aria-activedescendant needed */}
        <div
          ref={listboxRef}
          id="scope-listbox"
          role="listbox"
          aria-label="Leaderboard scope"
          onKeyDown={handleListboxKeyDown}
        >
          {/* Global option */}
          <DropdownItem
            id="scope-global"
            active={value.type === "global"}
            onClick={() => select({ type: "global" })}
          >
            <Globe className={iconClass} strokeWidth={1.5} />
            Global
          </DropdownItem>

          {/* Organizations group */}
          {organizations.length > 0 && (
            <>
              <div
                role="presentation"
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1"
              >
                Organizations
              </div>
              {organizations.map((org) => (
                <DropdownItem
                  key={org.id}
                  id={`scope-org-${org.id}`}
                  active={value.type === "org" && value.id === org.id}
                  onClick={() => select({ type: "org", id: org.id })}
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
              <div
                role="presentation"
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1"
              >
                Teams
              </div>
              {teams.map((team) => (
                <DropdownItem
                  key={team.id}
                  id={`scope-team-${team.id}`}
                  active={value.type === "team" && value.id === team.id}
                  onClick={() => select({ type: "team", id: team.id })}
                >
                  <TeamLogoIcon logoUrl={team.logoUrl} name={team.name} />
                  {team.name}
                </DropdownItem>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
