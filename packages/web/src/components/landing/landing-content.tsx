"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Copy, Terminal } from "lucide-react";
import { PassCard, PassPerforation } from "@/components/brand/badge-card";
import { agentColor } from "@/lib/palette";
import { sourceLabel } from "@/lib/usage-transforms";
import { cn } from "@/lib/utils";

/** Supported agents — keep in sync with @pew/core SOURCES / VALID_SOURCES */
const AGENTS = [
  "claude-code",
  "codex",
  "copilot-cli",
  "gemini-cli",
  "grok",
  "hermes",
  "kosmos",
  "omp",
  "opencode",
  "openclaw",
  "pi",
  "pmstudio",
  "vscode-copilot",
  "zcode",
] as const;

/** Decorative seat code — avoid culturally unlucky counts (e.g. 14). */
const SEAT_CODE = "17A";

// ---------------------------------------------------------------------------
// Shared field / chrome helpers (boarding-pass vernacular)
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/65">
      {children}
    </p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
  );
}

function Coupon({
  title,
  index,
  children,
  className,
  tinted,
}: {
  title: string;
  index: string;
  children: React.ReactNode;
  className?: string;
  tinted?: boolean;
}) {
  return (
    <section
      className={cn(
        "relative flex min-w-0 flex-1 flex-col px-4 py-5 sm:px-5 sm:py-6",
        tinted && "bg-secondary/35",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
          {title}
        </p>
        <span className="font-mono text-[9px] tracking-widest text-muted-foreground/45">
          {index}
        </span>
      </div>
      <div className="flex flex-1 flex-col">{children}</div>
    </section>
  );
}

/** Horizontal sci-fi craft — nose points right (LCL → AIN). */
function SpaceshipIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* thruster glow */}
      <path
        d="M2 10h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.35"
      />
      <path
        d="M1 7.5c1.5 1 1.5 4 0 5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.25"
      />
      {/* rear fin */}
      <path
        d="M10 4 L14 8.5 L14 11.5 L10 16 L8 12.5 L8 7.5 Z"
        fill="currentColor"
        opacity="0.55"
      />
      {/* hull */}
      <path
        d="M12 7.5 C16 5.5 24 5 30 7.2 C33 8.2 35.5 9.2 37 10 C35.5 10.8 33 11.8 30 12.8 C24 15 16 14.5 12 12.5 C11 12 10.5 11 10.5 10 C10.5 9 11 8 12 7.5 Z"
        fill="currentColor"
      />
      {/* canopy */}
      <ellipse cx="26" cy="10" rx="3.2" ry="2" fill="hsl(var(--background))" opacity="0.9" />
      <ellipse cx="26.4" cy="10" rx="1.6" ry="1" fill="currentColor" opacity="0.35" />
      {/* nose accent */}
      <path
        d="M33 9.2 C35 9.6 36.5 9.9 37.5 10 C36.5 10.1 35 10.4 33 10.8"
        stroke="hsl(var(--background))"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Install + dashboard CTAs
// ---------------------------------------------------------------------------

function InstallCommand() {
  const command = "npm install -g @nocoo/pew";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy install command: ${command}`}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-xl",
        "border border-border bg-card px-3 py-3 sm:gap-3 sm:px-3.5 sm:py-3.5",
        "font-mono text-[12px] sm:text-[13px]",
        "transition-colors duration-200",
        "hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "cursor-pointer text-left",
      )}
    >
      <Terminal
        className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="select-none text-muted-foreground" aria-hidden="true">
        $
      </span>
      <code className="min-w-0 flex-1 truncate text-foreground">{command}</code>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium sm:gap-1.5 sm:px-2 sm:text-xs",
          "transition-colors duration-200",
          copied
            ? "bg-success/15 text-success"
            : "bg-secondary text-muted-foreground group-hover:text-foreground",
        )}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only sm:inline">Copied</span>
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            <span className="sr-only sm:not-sr-only sm:inline">Copy</span>
          </>
        )}
      </span>
    </button>
  );
}

function DashboardCta() {
  return (
    <Link
      href="/login"
      className={cn(
        "group flex w-full items-center justify-center gap-2",
        "rounded-xl bg-primary px-4 py-3.5",
        "text-sm font-semibold text-primary-foreground",
        "shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.65)]",
        "transition-[transform,box-shadow,background-color] duration-200",
        "hover:bg-primary/90 hover:shadow-[0_10px_28px_-8px_hsl(var(--primary)/0.75)]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "active:translate-y-px",
      )}
    >
      Enter dashboard
      <ArrowRight
        className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Coupon panels — balanced mass across three columns
// ---------------------------------------------------------------------------

function PassengerCoupon() {
  return (
    <Coupon title="Passenger" index="01 / 03">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary ring-1 ring-border sm:h-14 sm:w-14">
          <Image
            src="/logo-80.png"
            alt=""
            width={56}
            height={56}
            className="h-12 w-12 sm:h-14 sm:w-14"
            priority
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0">
          <FieldLabel>Name</FieldLabel>
          <h1 className="font-handwriting text-3xl leading-none tracking-tight text-foreground sm:text-4xl">
            pew
          </h1>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Class</FieldLabel>
          <p className="mt-0.5 font-display text-sm font-semibold text-foreground">
            AI Native
          </p>
        </div>
        <div>
          <FieldLabel>Cabin</FieldLabel>
          <p className="mt-0.5 font-display text-sm font-semibold text-foreground">
            Local-first
          </p>
        </div>
        <div>
          <FieldLabel>Ticket</FieldLabel>
          <p className="mt-0.5 font-mono text-xs text-foreground">PEW-TOKEN</p>
        </div>
        <div>
          <FieldLabel>Status</FieldLabel>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Cleared
          </p>
        </div>
      </div>

      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
        Your pass to the contribution graph — counts{" "}
        <span className="text-foreground">tokens</span>, never conversations.
      </p>

      {/* Sequence lives here so boarding stub stays lean */}
      <div className="mt-auto border-t border-border/70 pt-4">
        <FieldLabel>Sequence</FieldLabel>
        <ol
          className="mt-2 space-y-1.5 text-[13px] text-muted-foreground"
          aria-label="Boarding sequence"
        >
          <li className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] text-primary" aria-hidden="true">
              1
            </span>
            <span>
              <Code>pew login</Code>
              <span className="text-muted-foreground/70"> · browser</span>
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] text-primary" aria-hidden="true">
              2
            </span>
            <span>
              <Code>pew init</Code>
              <span className="text-muted-foreground/70"> · hooks</span>
            </span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] text-primary" aria-hidden="true">
              3
            </span>
            <span>Launch — auto-sync</span>
          </li>
        </ol>
      </div>
    </Coupon>
  );
}

function FlightCoupon() {
  return (
    <Coupon title="Flight" index="02 / 03">
      {/* Route block — horizontal craft, nose → destination */}
      <div className="rounded-xl border border-border/80 bg-secondary/40 px-3 py-4 sm:px-4">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="min-w-0">
            <FieldLabel>From</FieldLabel>
            <p className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              LCL
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">Local logs</p>
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 px-1">
            <div className="flex w-full items-center gap-1.5">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-primary/40" />
              <SpaceshipIcon className="h-4 w-8 shrink-0 text-primary sm:h-5 sm:w-10" />
              <div className="h-px flex-1 bg-gradient-to-r from-primary/40 via-border to-transparent" />
            </div>
            <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground/50">
              PEW-01
            </span>
          </div>

          <div className="min-w-0 text-right">
            <FieldLabel>To</FieldLabel>
            <p className="font-display text-2xl font-bold tracking-tight text-primary sm:text-3xl">
              AIN
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">AI Native</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <div>
          <FieldLabel>Flight</FieldLabel>
          <p className="mt-0.5 font-display text-sm font-semibold text-foreground">PEW</p>
        </div>
        <div>
          <FieldLabel>Date</FieldLabel>
          <p className="mt-0.5 font-mono text-xs text-foreground">EVERY DAY</p>
        </div>
        <div>
          <FieldLabel>Fleet</FieldLabel>
          <p className="mt-0.5 font-display text-sm font-semibold text-foreground">FULL</p>
        </div>
      </div>

      <div className="mt-5 flex-1">
        <FieldLabel>Fleet · supported agents</FieldLabel>
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Supported agents">
          {AGENTS.map((source) => {
            const { color } = agentColor(source);
            return (
              <li key={source}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full",
                    "border border-border/80 bg-card px-2 py-0.5",
                    "text-[10px] font-medium text-foreground/90 sm:px-2.5 sm:py-1 sm:text-[11px]",
                  )}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden="true"
                  />
                  {sourceLabel(source)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-auto border-t border-border/70 pt-4">
        <FieldLabel>Gate codes</FieldLabel>
        <div className="mt-1.5 space-y-1 text-[12px] text-muted-foreground sm:text-[13px]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Code>pew sync</Code>
            <span className="text-muted-foreground/70">now</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Code>pew reset</Code>
            <span className="text-muted-foreground/70">re-scan</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Code>pew update</Code>
            <span className="text-muted-foreground/70">latest</span>
          </div>
        </div>
      </div>
    </Coupon>
  );
}

function BoardingCoupon() {
  return (
    <Coupon title="Boarding" index="03 / 03" tinted>
      <div className="grid grid-cols-3 gap-2.5">
        <div>
          <FieldLabel>Gate</FieldLabel>
          <p className="mt-0.5 font-display text-lg font-bold text-foreground">CLI</p>
        </div>
        <div>
          <FieldLabel>Seat</FieldLabel>
          <p className="mt-0.5 font-display text-lg font-bold text-foreground">{SEAT_CODE}</p>
        </div>
        <div>
          <FieldLabel>Zone</FieldLabel>
          <p className="mt-0.5 font-display text-lg font-bold text-primary">NOW</p>
        </div>
      </div>

      <div className="mt-5">
        <FieldLabel>Check-in</FieldLabel>
        <div className="mt-1.5">
          <InstallCommand />
        </div>
      </div>

      <div className="mt-4">
        <FieldLabel>Board</FieldLabel>
        <div className="mt-1.5">
          <DashboardCta />
        </div>
      </div>

      <p className="mt-auto pt-5 text-[10px] leading-relaxed text-muted-foreground/55">
        Some agents lack a session-end hook — they board on the next{" "}
        <Code>pew sync</Code>.
      </p>
    </Coupon>
  );
}

// ---------------------------------------------------------------------------
// Landing — 3-coupon boarding pass to AI Native
// ---------------------------------------------------------------------------

export function LandingContent() {
  return (
    <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-3 py-8 sm:px-6 sm:py-10 lg:py-12">
      <div className="animate-fade-up" style={{ animationDelay: "40ms" }}>
        <PassCard
          badge="BOARDING PASS"
          destination="Destination · AI Native"
          meta="FLIGHT PEW · FULL FLEET · LOCAL-FIRST"
          footer={
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                <span className="text-[10px] text-muted-foreground">Gate open</span>
              </div>
              <span className="text-muted-foreground/30" aria-hidden="true">
                ·
              </span>
              <span className="text-[10px] text-muted-foreground">
                Tokens only · never conversations
              </span>
              <span className="hidden text-muted-foreground/30 sm:inline" aria-hidden="true">
                ·
              </span>
              <span className="text-[10px] text-muted-foreground">Privacy by default</span>
            </div>
          }
        >
          <div className="flex flex-col lg:flex-row lg:items-stretch">
            <PassengerCoupon />

            <PassPerforation orientation="horizontal" className="lg:hidden" />
            <PassPerforation
              orientation="vertical"
              className="hidden py-5 lg:flex"
            />

            <FlightCoupon />

            <PassPerforation orientation="horizontal" className="lg:hidden" />
            <PassPerforation
              orientation="vertical"
              className="hidden py-5 lg:flex"
            />

            <BoardingCoupon />
          </div>
        </PassCard>
      </div>
    </main>
  );
}
