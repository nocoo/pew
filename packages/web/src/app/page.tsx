import Link from "next/link";
import { Github, LogIn } from "lucide-react";
import { LandingContent } from "@/components/landing/landing-content";

export default function LandingPage() {
  return (
    <div className="relative flex h-screen flex-col bg-background overflow-hidden">
      {/* Top-right icons */}
      <div className="absolute right-6 top-4 z-50 flex items-center gap-3">
        <a
          href="https://github.com/nicnocquee/pew"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="GitHub"
        >
          <Github className="h-5 w-5" strokeWidth={1.5} />
        </a>
        <Link
          href="/login"
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Sign in"
        >
          <LogIn className="h-5 w-5" strokeWidth={1.5} />
        </Link>
      </div>

      {/* Main — fills remaining space */}
      <LandingContent />

      {/* Footer — single compact line */}
      <footer className="border-t border-border/50 px-6 py-3">
        <div className="mx-auto max-w-6xl text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} pew.md
        </div>
      </footer>
    </div>
  );
}
