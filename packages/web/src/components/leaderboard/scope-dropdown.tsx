"use client";

import { Button } from "@nocoo/basalt/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nocoo/basalt/components/dropdown-menu";
import { Globe, ChevronDown } from "lucide-react";
import { TeamLogoIcon, OrgLogoIcon } from "@/components/leaderboard/logo-icons";
import { cn } from "@/lib/utils";
import type { ScopeSelection, Organization, Team } from "@/lib/leaderboard-scope";

export type { ScopeSelection, Organization, Team } from "@/lib/leaderboard-scope";

const iconClass = "h-3.5 w-3.5 shrink-0 text-basalt-muted-foreground";

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
  if (organizations.length === 0 && teams.length === 0) return null;

  const selectedOrg = value.type === "org" ? organizations.find((o) => o.id === value.id) : null;
  const selectedTeam = value.type === "team" ? teams.find((t) => t.id === value.id) : null;
  const label =
    value.type === "global" ? "Global" : (selectedOrg?.name ?? selectedTeam?.name ?? "Global");

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          {labelIcon}
          {label}
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
      >
        <DropdownMenuItem
          className={cn("gap-2", value.type === "global" && "bg-basalt-accent")}
          onSelect={() => onChange({ type: "global" })}
        >
          <Globe className={iconClass} strokeWidth={1.5} />
          Global
        </DropdownMenuItem>
        {organizations.length > 0 && (
          <DropdownMenuGroup>
            <div
              role="presentation"
              className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-basalt-muted-foreground"
            >
              Organizations
            </div>
            {organizations.map((org) => (
              <DropdownMenuItem
                key={org.id}
                className={cn(
                  "gap-2",
                  value.type === "org" && value.id === org.id && "bg-basalt-accent",
                )}
                onSelect={() => onChange({ type: "org", id: org.id })}
              >
                <OrgLogoIcon logoUrl={org.logoUrl} name={org.name} />
                {org.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {teams.length > 0 && (
          <DropdownMenuGroup>
            <div
              role="presentation"
              className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-basalt-muted-foreground"
            >
              Teams
            </div>
            {teams.map((team) => (
              <DropdownMenuItem
                key={team.id}
                className={cn(
                  "gap-2",
                  value.type === "team" && value.id === team.id && "bg-basalt-accent",
                )}
                onSelect={() => onChange({ type: "team", id: team.id })}
              >
                <TeamLogoIcon logoUrl={team.logoUrl} name={team.name} />
                {team.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
