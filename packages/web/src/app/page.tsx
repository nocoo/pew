import { ShieldCheck } from "lucide-react";
import { Github } from "@/components/icons/github";
import { LandingContent } from "@/components/landing/landing-content";
import { SiteFooter } from "@/components/layout/site-footer";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function LandingPage() {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Ambient brand glow — soft violet wash, stays within Basalt tokens */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0"
          style={{
            background: [
              "radial-gradient(ellipse 55% 45% at 18% 42%,",
              "hsl(var(--primary) / 0.09) 0%,",
              "hsl(var(--primary) / 0.04) 35%,",
              "transparent 70%)",
            ].join(" "),
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: [
              "radial-gradient(ellipse 50% 40% at 82% 58%,",
              "hsl(var(--primary) / 0.07) 0%,",
              "hsl(var(--primary) / 0.03) 40%,",
              "transparent 72%)",
            ].join(" "),
          }}
        />
        {/* Faint contribution-grid texture */}
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.22]"
          style={{
            backgroundImage: [
              "linear-gradient(to right, hsl(var(--foreground) / 0.035) 1px, transparent 1px)",
              "linear-gradient(to bottom, hsl(var(--foreground) / 0.035) 1px, transparent 1px)",
            ].join(", "),
            backgroundSize: "28px 28px",
            maskImage:
              "radial-gradient(ellipse 70% 60% at 50% 50%, black 20%, transparent 75%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 70% 60% at 50% 50%, black 20%, transparent 75%)",
          }}
        />
      </div>

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

      <LandingContent />

      <div className="relative z-10">
        <SiteFooter />
      </div>
    </div>
  );
}
