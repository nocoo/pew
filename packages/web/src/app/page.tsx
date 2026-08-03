import { ShieldCheck } from "lucide-react";
import { BadgeAmbientGlow } from "@/components/brand/badge-card";
import { Github } from "@/components/icons/github";
import { LandingContent } from "@/components/landing/landing-content";
import { SiteFooter } from "@/components/layout/site-footer";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <BadgeAmbientGlow />

      {/* Top-right icons — same pattern as login */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-1">
        <a
          href="/privacy"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Privacy policy"
        >
          <ShieldCheck className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
        </a>
        <a
          href="https://github.com/nocoo/pew"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="View source on GitHub"
        >
          <Github className="h-[18px] w-[18px]" strokeWidth={1.5} aria-hidden="true" />
        </a>
        <ThemeToggle />
      </div>

      <LandingContent />

      <div className="relative z-10">
        <SiteFooter />
      </div>
    </div>
  );
}
