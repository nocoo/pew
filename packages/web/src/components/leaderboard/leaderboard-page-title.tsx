import { PageHeader } from "@nocoo/basalt/components/page-header";

// ---------------------------------------------------------------------------
// LeaderboardPageTitle — shared heading for public leaderboard pages
// ---------------------------------------------------------------------------

interface LeaderboardPageTitleProps {
  /** Page title (e.g. "Leaderboard", "Seasons") */
  subtitle: string;
  /** Supporting text below the title */
  description: string;
}

export function LeaderboardPageTitle({
  subtitle,
  description,
}: LeaderboardPageTitleProps) {
  return <PageHeader title={subtitle} description={description} />;
}
