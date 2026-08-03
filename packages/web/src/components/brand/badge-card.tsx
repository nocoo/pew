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

export function PunchHole({ className }: { className?: string }) {
  return (
    <div
      className={cn("h-4 w-8 shrink-0 rounded-full bg-background/80", className)}
      style={{
        boxShadow:
          "inset 0 1.5px 3px rgba(0,0,0,0.35), inset 0 -0.5px 1px rgba(255,255,255,0.1)",
      }}
      aria-hidden="true"
    />
  );
}

export function credentialId() {
  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ID ${year}-${today.slice(4)}`;
}

export interface PassHeaderProps {
  /** Right-side ticket type, e.g. BOARDING PASS */
  badge?: string;
  /** Secondary line under brand (product destination / tagline) */
  destination?: string;
  /** Mono meta row after the ID */
  meta?: string;
  className?: string;
}

/**
 * Landscape boarding-pass header chrome for the landing card.
 * Punch hole + brand + barcode — decoration lives here, not in the body.
 */
export function PassHeader({
  badge = "BOARDING PASS",
  destination,
  meta = "LOCAL-FIRST · TOKENS ONLY",
  className,
}: PassHeaderProps) {
  return (
    <div className={cn("bg-primary px-4 py-2.5 sm:px-5 sm:py-3", className)}>
      <div className="flex items-center gap-3 sm:gap-4">
        <PunchHole />

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Image
            src="/logo-24.png"
            alt=""
            width={16}
            height={16}
            className="brightness-0 invert"
            aria-hidden="true"
          />
          <span className="font-handwriting text-base font-semibold leading-none text-primary-foreground">
            pew
          </span>
          <span
            className="hidden text-primary-foreground/30 sm:inline"
            aria-hidden="true"
          >
            ·
          </span>
          <span className="hidden text-xs text-primary-foreground/55 sm:inline">
            Show your tokens
          </span>
          {destination ? (
            <>
              <span
                className="hidden text-primary-foreground/30 md:inline"
                aria-hidden="true"
              >
                ·
              </span>
              <span className="hidden font-display text-xs font-semibold tracking-wide text-primary-foreground/80 md:inline">
                {destination}
              </span>
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-primary-foreground/70">
            {badge}
          </span>
          <div className="h-5" aria-hidden="true">
            <Barcode />
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 font-mono text-[9px] tracking-wider text-primary-foreground/40">
        <span>{credentialId()}</span>
        {meta ? (
          <>
            <span className="text-primary-foreground/25" aria-hidden="true">
              ·
            </span>
            <span>{meta}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Vertical work-badge chrome (login). Punch hole + barcode strip —
 * employee ID / bank badge metaphor.
 */
export function BadgeCard({
  children,
  badge = "DEV",
  footer,
  className,
  contentClassName,
}: BadgeCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl bg-card",
        "ring-1 ring-black/[0.08] dark:ring-white/[0.06]",
        className,
      )}
      style={{ boxShadow: BADGE_CARD_SHADOW }}
    >
      <div className="bg-primary px-5 py-4">
        <div className="flex items-center justify-between">
          <PunchHole />
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
            {credentialId()}
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

/** Tear line between boarding-pass coupons (vertical desktop / horizontal mobile). */
export function PassPerforation({
  orientation = "vertical",
  className,
}: {
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  if (orientation === "horizontal") {
    return (
      <div
        className={cn("flex items-center gap-2 px-3", className)}
        aria-hidden="true"
      >
        <div className="h-2 w-2 shrink-0 rounded-full border border-border bg-background" />
        <div className="h-px flex-1 border-t border-dashed border-border" />
        <div className="h-2 w-2 shrink-0 rounded-full border border-border bg-background" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex w-4 shrink-0 flex-col items-center self-stretch",
        className,
      )}
      aria-hidden="true"
    >
      <div className="h-2 w-2 shrink-0 rounded-full border border-border bg-background" />
      <div className="w-px flex-1 border-l border-dashed border-border" />
      <div className="h-2 w-2 shrink-0 rounded-full border border-border bg-background" />
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
