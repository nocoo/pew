import { ShieldCheck } from "lucide-react";
import { Github } from "@/components/icons/github";
import { LandingContent } from "@/components/landing/landing-content";
import { SiteFooter } from "@/components/layout/site-footer";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function LandingPage() {
  return (
    <div className="relative flex h-screen flex-col bg-background overflow-hidden">
      {/* Top-right icons */}
      <div className="absolute right-6 top-4 z-50 flex items-center gap-1">
        <a
          href="/privacy"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-[color] duration-200 hover:text-foreground"
          aria-label="Privacy policy"
        >
          <ShieldCheck className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </a>
        <a
          href="https://github.com/nocoo/pew"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-[color] duration-200 hover:text-foreground"
          aria-label="View source on GitHub"
        >
          <Github className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </a>
        <ThemeToggle />
      </div>

      {/* Main — fills remaining space */}
      <LandingContent />

      <SiteFooter />
    </div>
  );
}
