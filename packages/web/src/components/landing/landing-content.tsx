"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Copy, Terminal } from "lucide-react";
import {
  BADGE_CARD_SHADOW,
  PassHeader,
  PassPerforation,
} from "@/components/brand/badge-card";
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

const INSTALL_CMD = "npm install -g @nocoo/pew";

const NO_HOOK_NOTE =
  "Some agents have no session-end hook — they sync on the next pew sync.";

// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/65">
      {children}
    </p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-foreground sm:text-[12px]">
      {children}
    </code>
  );
}

function Coupon({
  title,
  children,
  className,
  tinted,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  tinted?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col px-3.5 pt-4 pb-5 sm:px-4 sm:pt-4 sm:pb-6",
        tinted && "bg-secondary/40",
        className,
      )}
    >
      <p className="mb-2.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
        {title}
      </p>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** Horizontal craft for the route block — nose points right. */
function SpaceshipIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2 10h6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.35"
      />
      <path
        d="M10 4 L14 8.5 L14 11.5 L10 16 L8 12.5 L8 7.5 Z"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M12 7.5 C16 5.5 24 5 30 7.2 C33 8.2 35.5 9.2 37 10 C35.5 10.8 33 11.8 30 12.8 C24 15 16 14.5 12 12.5 C11 12 10.5 11 10.5 10 C10.5 9 11 8 12 7.5 Z"
        fill="currentColor"
      />
      <ellipse cx="26" cy="10" rx="3.2" ry="2" fill="hsl(var(--background))" opacity="0.9" />
    </svg>
  );
}

function InstallCommand() {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied install command" : `Copy install command: ${INSTALL_CMD}`}
      className={cn(
        "group flex w-full min-w-0 items-center gap-1.5 overflow-x-auto rounded-lg",
        "border border-border bg-card px-2 py-2 sm:gap-2 sm:px-2.5",
        "font-mono text-[11px] sm:text-xs",
        "transition-colors duration-200 hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "cursor-pointer text-left scrollbar-hide",
      )}
    >
      <Terminal
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="select-none text-muted-foreground" aria-hidden="true">
        $
      </span>
      <code className="min-w-0 shrink whitespace-nowrap text-foreground">
        {INSTALL_CMD}
      </code>
      <span className="min-w-2 flex-1" aria-hidden="true" />
      <span
        className={cn(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
          copied
            ? "bg-success/15 text-success"
            : "bg-secondary text-muted-foreground group-hover:text-foreground",
        )}
        aria-hidden="true"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
        ) : (
          <Copy className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Four coupons
// ---------------------------------------------------------------------------

function PassengerCoupon() {
  return (
    <Coupon title="Passenger" className="lg:flex-[1.05]">
      <div className="flex items-center gap-2.5">
        <Image
          src="/logo-80.png"
          alt=""
          width={44}
          height={44}
          className="h-11 w-11 shrink-0"
          priority
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h1 className="font-handwriting text-3xl leading-none tracking-tight text-foreground">
            pew
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Token tracker</p>
        </div>
      </div>

      <p className="mt-3 font-display text-sm font-semibold leading-snug tracking-tight text-foreground">
        The contribution graph for AI-native devs.
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        Counts <span className="text-foreground">tokens</span>, never conversations.
        Local-first · privacy by default.
      </p>

      <div className="mt-auto grid grid-cols-2 gap-2 border-t border-border/70 pt-3">
        <div>
          <FieldLabel>Class</FieldLabel>
          <p className="mt-0.5 text-xs font-semibold text-foreground">AI Native</p>
        </div>
        <div>
          <FieldLabel>Cabin</FieldLabel>
          <p className="mt-0.5 text-xs font-semibold text-foreground">Local-first</p>
        </div>
      </div>
    </Coupon>
  );
}

function FlightCoupon() {
  return (
    <Coupon title="Flight" className="lg:flex-[1.2]">
      {/* FROM → TO — boarding-pass route decoration */}
      <div className="rounded-lg border border-border/80 bg-secondary/30 px-2.5 py-2.5 sm:px-3">
        <div className="flex items-center justify-between gap-1.5">
          <div className="min-w-0">
            <FieldLabel>From</FieldLabel>
            <p className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              LCL
            </p>
            <p className="truncate text-[10px] text-muted-foreground">Local logs</p>
          </div>

          <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1">
            <div className="flex w-full items-center gap-1">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-primary/40" />
              <SpaceshipIcon className="h-3.5 w-7 shrink-0 text-primary sm:h-4 sm:w-8" />
              <div className="h-px flex-1 bg-gradient-to-r from-primary/40 via-border to-transparent" />
            </div>
          </div>

          <div className="min-w-0 text-right">
            <FieldLabel>To</FieldLabel>
            <p className="font-display text-xl font-bold tracking-tight text-primary sm:text-2xl">
              AIN
            </p>
            <p className="truncate text-[10px] text-muted-foreground">AI Native</p>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <FieldLabel>Fleet · agents</FieldLabel>
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Supported agents">
          {AGENTS.map((source) => {
            const { color } = agentColor(source);
            return (
              <li key={source}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full",
                    "border border-border/70 bg-card px-1.5 py-0.5",
                    "text-[10px] font-medium text-foreground/90",
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
    </Coupon>
  );
}

function BoardingCoupon() {
  return (
    <Coupon title="Boarding" className="lg:min-w-[220px] lg:flex-[1.45]">
      <FieldLabel>Check-in</FieldLabel>
      <div className="mt-1.5 min-w-0">
        <InstallCommand />
      </div>

      <ol
        className="mt-3 space-y-1 text-xs text-muted-foreground sm:text-[13px]"
        aria-label="Quick start"
      >
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] text-primary" aria-hidden="true">
            1
          </span>
          <span>
            <Code>pew login</Code>
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] text-primary" aria-hidden="true">
            2
          </span>
          <span>
            <Code>pew init</Code>
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-[10px] text-primary" aria-hidden="true">
            3
          </span>
          <span>auto-sync after sessions</span>
        </li>
      </ol>

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground/60">{NO_HOOK_NOTE}</p>

      <Link
        href="/login"
        className={cn(
          "mt-auto inline-flex h-10 w-full items-center justify-center gap-1.5",
          "rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground",
          "shadow-[0_8px_20px_-10px_hsl(var(--primary)/0.65)]",
          "transition-[transform,background-color] duration-200",
          "hover:bg-primary/90",
          "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "active:translate-y-px",
        )}
      >
        Enter dashboard
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </Coupon>
  );
}

/** Tear-off stub — handy commands as 附卷 */
function CommandsStub() {
  return (
    <Coupon title="Commands" tinted className="lg:w-[152px] lg:flex-none lg:shrink-0 xl:w-[168px]">
      <div className="space-y-2 text-xs text-muted-foreground sm:text-[13px]">
        <div>
          <Code>pew sync</Code>
          <p className="mt-0.5 text-[10px] text-muted-foreground/70">sync now</p>
        </div>
        <div>
          <Code>pew status</Code>
          <p className="mt-0.5 text-[10px] text-muted-foreground/70">local summary</p>
        </div>
        <div>
          <Code>pew reset</Code>
          <p className="mt-0.5 text-[10px] text-muted-foreground/70">full re-scan</p>
        </div>
        <div>
          <Code>pew update</Code>
          <p className="mt-0.5 text-[10px] text-muted-foreground/70">latest version</p>
        </div>
      </div>

      <p className="mt-auto pt-3 text-[10px] leading-snug text-muted-foreground/50">
        Keep this stub · gate CLI
      </p>
    </Coupon>
  );
}

// ---------------------------------------------------------------------------

export function LandingContent() {
  return (
    <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-3 py-5 sm:px-5 sm:py-8">
      <div
        className="animate-fade-up overflow-hidden rounded-2xl bg-card ring-1 ring-black/[0.08] dark:ring-white/[0.06]"
        style={{ boxShadow: BADGE_CARD_SHADOW, animationDelay: "40ms" }}
      >
        <PassHeader
          badge="BOARDING PASS"
          meta="LOCAL-FIRST · READ-ONLY · TOKENS ONLY"
        />

        {/*
          Long 4-coupon pass:
          Passenger | Flight (FROM→TO) | Boarding | Commands stub
          Mobile: stack with horizontal tears
          lg+: single flat row
        */}
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <PassengerCoupon />

          <PassPerforation orientation="horizontal" className="lg:hidden" />
          <PassPerforation orientation="vertical" className="hidden py-3 lg:flex" />

          <FlightCoupon />

          <PassPerforation orientation="horizontal" className="lg:hidden" />
          <PassPerforation orientation="vertical" className="hidden py-3 lg:flex" />

          <BoardingCoupon />

          <PassPerforation orientation="horizontal" className="lg:hidden" />
          <PassPerforation orientation="vertical" className="hidden py-3 lg:flex" />

          <CommandsStub />
        </div>
      </div>
    </main>
  );
}
