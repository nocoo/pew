/**
 * Check-style ruling lines — faint horizontal lines covering the right 1/3
 * of a card row, evoking a financial ledger / check-stub aesthetic.
 */
export function CheckRuling() {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-[0.04]"
      aria-hidden="true"
    >
      <div className="absolute inset-0 flex flex-col justify-evenly">
        {Array.from({ length: 5 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: compile-time constant tuple; positional key is authoritative.
          <div key={`rule-${i}`} className="h-px bg-foreground" />
        ))}
      </div>
    </div>
  );
}
