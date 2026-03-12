import { Github } from "lucide-react";
import { LandingContent } from "@/components/landing/landing-content";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function LandingPage() {
  return (
    <div className="relative flex h-screen flex-col bg-background overflow-hidden">
      {/* Top-right icons */}
      <div className="absolute right-6 top-4 z-50 flex items-center gap-1">
        <a
          href="https://github.com/nicnocquee/pew"
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

      {/* Footer */}
      <footer className="px-6 py-3">
        <p className="text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} pew.md
          <span className="mx-1.5">·</span>
          <a href="/privacy" className="hover:text-foreground transition-colors">
            Privacy
          </a>
        </p>
      </footer>
    </div>
  );
}
