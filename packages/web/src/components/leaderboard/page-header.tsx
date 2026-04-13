import Link from "next/link";
import Image from "next/image";

/**
 * Shared page header for leaderboard pages — logo + title slot.
 *
 * Features a subtle gradient background inspired by WoW Armory's hero header:
 * a dark-to-transparent gradient with a faint teal glow at the top, creating
 * visual separation from the body while staying within pew's Basalt palette.
 *
 * Each page provides its own title content via the `children` prop so that
 * the season detail page can show the season name instead of a generic title.
 */
export function PageHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="relative pt-10 pb-4 overflow-hidden">
      {/* Gradient overlay — faint teal glow fading into body background */}
      <div
        className="pointer-events-none absolute inset-0 -top-16"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 0%, hsl(var(--primary) / 0.08) 0%, transparent 70%)",
        }}
      />
      <div
        className="relative flex items-center gap-5 animate-fade-up"
      >
        <Link
          href="/"
          className="shrink-0 hover:opacity-80 transition-opacity"
        >
          <Image
            src="/logo-80.png"
            alt="pew"
            width={48}
            height={48}
          />
        </Link>
        <div className="flex flex-col min-w-0">{children}</div>
      </div>
    </header>
  );
}
