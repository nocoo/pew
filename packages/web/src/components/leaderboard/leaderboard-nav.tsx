"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { href: "/leaderboard", label: "Individual" },
  { href: "/leaderboard/seasons", label: "Seasons" },
  { href: "/leaderboard/achievements", label: "Achievements" },
  { href: "/leaderboard/agents", label: "Agents" },
  { href: "/leaderboard/models", label: "Models" },
  { href: "/leaderboard/showcases", label: "Showcases" },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Route-based tab navigation for leaderboard pages.
 *
 * Inspired by WoW Armory's HorizontalNav --underline style:
 * uppercase labels with an animated bottom indicator on the active tab.
 * Adapted to pew's Basalt design system (teal primary, muted foreground).
 */
export function LeaderboardNav() {
  const pathname = usePathname();

  return (
    <nav
      className="relative flex gap-6 border-b border-border animate-fade-up overflow-x-auto scrollbar-hide"
      style={{ animationDelay: "120ms" }}
      aria-label="Leaderboard navigation"
    >
      {TABS.map((tab) => {
        const isActive = tab.href === "/leaderboard"
          ? pathname === "/leaderboard"
          : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "relative shrink-0 whitespace-nowrap pb-2.5 text-sm font-semibold uppercase tracking-wider transition-colors",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {/* Active underline indicator */}
            {isActive && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary rounded-full" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
