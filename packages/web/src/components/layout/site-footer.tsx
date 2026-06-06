import { Github } from "@/components/icons/github";

const GITHUB_URL = "https://github.com/nocoo/pew";

/**
 * Shared site footer for public pages (landing, login, leaderboard, seasons).
 *
 * Dashboard uses AppShell and does NOT render this footer.
 */
export function SiteFooter() {
  return (
    <footer className="px-6 py-3">
      <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5 flex-wrap">
        <span>&copy; {new Date().getFullYear()} pew.md</span>
        <span className="text-muted-foreground/40">&middot;</span>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <Github className="h-3 w-3" />
          GitHub
        </a>
        <span className="text-muted-foreground/40">&middot;</span>
        <a
          href="/privacy"
          className="hover:text-foreground transition-colors"
        >
          Privacy
        </a>
      </p>
    </footer>
  );
}
