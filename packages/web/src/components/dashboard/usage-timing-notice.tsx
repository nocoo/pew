import { createElement } from "react";

/** Explain the date limitation without exposing accounting internals. */
export function UsageTimingNotice({ records }: {
  records: ReadonlyArray<{ approximate_tokens?: number }> | undefined;
}) {
  const tokens = records?.reduce((n, row) => n + (row.approximate_tokens ?? 0), 0) ?? 0;
  if (tokens <= 0) return null;
  return createElement("p", { className: "text-sm text-muted-foreground" },
    `${tokens.toLocaleString("en-US")} tokens have approximate timing. They are shown at session start or the end of an observed interval; daily and hourly comparisons may shift.`);
}
