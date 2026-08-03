import type { ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/** Multi-layer elevation used by login + landing badge cards */
export const BADGE_CARD_SHADOW = [
  "0 1px 2px rgba(0,0,0,0.06)",
  "0 4px 8px rgba(0,0,0,0.04)",
  "0 12px 24px rgba(0,0,0,0.06)",
  "0 24px 48px rgba(0,0,0,0.04)",
  "0 0 0 0.5px rgba(0,0,0,0.02)",
  "0 0 60px rgba(0,0,0,0.03)",
].join(", ");

export function Barcode() {
  const bars = [2, 1, 3, 1, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1];
  return (
    <div className="flex h-full items-stretch gap-[1.5px]">
      {bars.map((w, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: compile-time constant tuple; positional key is authoritative.
          key={`bar-${i}`}
          className="rounded-[0.5px] bg-primary-foreground"
          style={{ width: `${w * 1.5}px`, opacity: i % 3 === 0 ? 0.9 : 0.5 }}
        />
      ))}
    </div>
  );
}

export interface BadgeCardProps {
  children: ReactNode;
  /** Small uppercase label in the primary header (e.g. DEV, CLI) */
  badge?: string;
  /** Optional footer content inside the status strip */
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * Shared "bank badge" card chrome — primary header strip, punch hole,
 * barcode ID row, multi-layer shadow. Used by login and landing CTA.
 */
export function BadgeCard({
  children,
  badge = "DEV",
  footer,
  className,
  contentClassName,
}: BadgeCardProps) {
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl bg-card",
        "ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
        className,
      )}
      style={{ boxShadow: BADGE_CARD_SHADOW }}
    >
      {/* Header strip with punch hole + barcode */}
      <div className="bg-primary px-5 py-4">
        <div className="flex items-center justify-between">
          <div
            className="h-4 w-8 rounded-full bg-background/80"
            style={{
              boxShadow:
                "inset 0 1.5px 3px rgba(0,0,0,0.35), inset 0 -0.5px 1px rgba(255,255,255,0.1)",
            }}
            aria-hidden="true"
          />
          <div className="flex items-center gap-2">
            <Image
              src="/logo-24.png"
              alt=""
              width={16}
              height={16}
              className="brightness-0 invert"
              aria-hidden="true"
            />
            <span className="font-handwriting text-sm font-semibold text-primary-foreground">
              pew
            </span>
          </div>
          <span className="text-[10px] font-medium uppercase tracking-widest text-primary-foreground/60">
            {badge}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-wider text-primary-foreground/40">
            ID {year}-{today.slice(4)}
          </span>
          <div className="h-6" aria-hidden="true">
            <Barcode />
          </div>
        </div>
      </div>

      <div className={cn("flex flex-1 flex-col", contentClassName)}>{children}</div>

      {footer != null && (
        <div className="mt-auto flex items-center justify-center border-t border-border bg-secondary/50 py-2.5">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Soft centered radial wash used behind public badge cards (login / landing). */
export function BadgeAmbientGlow() {
  return (
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      style={{
        background: [
          "radial-gradient(ellipse 70% 55% at 50% 50%,",
          "hsl(var(--foreground) / 0.045) 0%,",
          "hsl(var(--foreground) / 0.042) 10%,",
          "hsl(var(--foreground) / 0.036) 20%,",
          "hsl(var(--foreground) / 0.028) 32%,",
          "hsl(var(--foreground) / 0.020) 45%,",
          "hsl(var(--foreground) / 0.012) 58%,",
          "hsl(var(--foreground) / 0.006) 72%,",
          "hsl(var(--foreground) / 0.002) 86%,",
          "transparent 100%)",
        ].join(" "),
      }}
    />
  );
}
