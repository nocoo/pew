import { Button } from "@nocoo/basalt/components/button";
import { ShieldCheck } from "lucide-react";
import { Github } from "@/components/icons/github";
import { chromeIconClassName } from "@/lib/ghost-icon";
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
        <Button variant="ghost" size="icon" className={chromeIconClassName} asChild>
          <a href="/privacy" aria-label="Privacy policy">
            <ShieldCheck strokeWidth={1.5} aria-hidden="true" />
          </a>
        </Button>
        <Button variant="ghost" size="icon" className={chromeIconClassName} asChild>
          <a
            href="https://github.com/nocoo/pew"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View source on GitHub"
          >
            <Github strokeWidth={1.5} aria-hidden="true" />
          </a>
        </Button>
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
