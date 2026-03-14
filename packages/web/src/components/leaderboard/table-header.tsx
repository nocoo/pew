/**
 * Column header row for leaderboard tables.
 *
 * Inspired by WoW Armory's SortTable-head: a row of uppercase, small-caps
 * labels that mirrors the data columns below. Followed by a thin silver
 * divider (Armory's Divider--thin--silver).
 *
 * Column widths must stay in sync with LeaderboardRow layout:
 *   Rank (w-8) | gap-3 | Avatar (w-8) + gap-3 + Name (flex-1) | In (w-20 shrink-0) | Out (w-20 shrink-0) | Total (w-[140px] sm:w-[180px])
 *
 * Responsive: In/Out columns are hidden on mobile (sm:), matching the
 * data rows that also hide token breakdown on narrow screens.
 */
export function TableHeader() {
  return (
    <div className="animate-fade-up" style={{ animationDelay: "200ms" }}>
      {/* Column labels — px-4 matches row padding */}
      <div className="flex items-center px-4 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        {/* Rank — matches row's w-8 rank column */}
        <span className="w-8 shrink-0 text-center">Rank</span>
        {/* Gap placeholder — matches row's gap-3 between rank and avatar+name */}
        <span className="w-3 shrink-0" />
        {/* Player — avatar (w-8) + gap-3 + name fills flex-1 */}
        <span className="flex-1">Player</span>
        {/* In — matches row's input token column */}
        <span className="hidden sm:block w-20 shrink-0 text-right">In</span>
        {/* Out — matches row's output token column */}
        <span className="hidden sm:block w-20 shrink-0 text-right">Out</span>
        {/* Tokens — matches row's total column */}
        <span className="w-[140px] sm:w-[180px] shrink-0 text-right">Tokens</span>
      </div>
      {/* Thin divider — Armory's Divider--thin--silver */}
      <div className="h-px bg-border/50" />
    </div>
  );
}
