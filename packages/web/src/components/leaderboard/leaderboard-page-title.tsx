import { PageHeader } from "@/components/leaderboard/page-header";

// ---------------------------------------------------------------------------
// LeaderboardPageTitle — shared "pew" heading used by every leaderboard page
// ---------------------------------------------------------------------------

interface LeaderboardPageTitleProps {
  /** Text shown next to "pew" (e.g. "Leaderboard", "Seasons") */
  subtitle: string;
  /** Short description below the heading */
  description: string;
}

export function LeaderboardPageTitle({
  subtitle,
  description,
}: LeaderboardPageTitleProps) {
  return (
    <PageHeader>
      <h1 className="tracking-tight text-foreground">
        <span className="text-[36px] font-bold font-handwriting leading-none mr-2">
          pew
        </span>
        <span className="text-[19px] font-normal text-muted-foreground">
          {subtitle}
        </span>
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </PageHeader>
  );
}
