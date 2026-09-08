import { Button } from "@nocoo/basalt/components/button";
import { chromeIconClassName } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { BadgeAmbientGlow } from "@/components/brand/badge-card";
import { Github } from "@/components/icons/github";
import { LandingContent } from "@/components/landing/landing-content";
import { SiteFooter } from "@/components/layout/site-footer";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-basalt-background">
      <BadgeAmbientGlow />

      <div className="absolute top-4 right-4 z-50 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className={chromeIconClassName}
          asChild
        >
          <a href="/privacy" aria-label="Privacy policy">
            <ShieldCheck strokeWidth={1.5} aria-hidden="true" />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={chromeIconClassName}
          asChild
        >
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

      <LandingContent />

      <div className="relative z-10">
        <SiteFooter />
      </div>
    </div>
  );
}
