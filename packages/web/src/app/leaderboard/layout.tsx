import Link from "next/link";
import { Github, ShieldCheck } from "lucide-react";
import { SiteFooter } from "@/components/layout/site-footer";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/**
 * Shared layout for all /leaderboard/* pages.
 *
 * Renders the outer shell (top-right icons, centered container, footer).
 * Pages render their own header + nav + content inside {children}.
 */
export default function LeaderboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Top-right icons — same pattern as landing page */}
      <div className="absolute right-6 top-4 z-50 flex items-center gap-1">
        <Link
          href="/privacy"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-[color] duration-200 hover:text-foreground"
          aria-label="Privacy policy"
        >
          <ShieldCheck
            className="h-4 w-4"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </Link>
        <a
          href="https://github.com/nocoo/pew"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-[color] duration-200 hover:text-foreground"
          aria-label="View source on GitHub"
        >
          <Github
            className="h-4 w-4"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </a>
        <ThemeToggle />
      </div>

      {/* Centered content area — pages render header + nav + main */}
      <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col px-6">
        {children}
      </div>

      <SiteFooter />
    </div>
  );
}
