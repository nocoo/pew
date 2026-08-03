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

const INSTALL_CMD = "npm install -g @nocoo/pew";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/65">
      {children}
    </p>
  );
}

function Field({
  label,
  children,
  className,
  align = "left",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right" | "center";
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      <FieldLabel>{label}</FieldLabel>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
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
      <ellipse cx="26.4" cy="10" rx="1.6" ry="1" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Commands — one block, full width
// ---------------------------------------------------------------------------

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
        "group flex w-full min-w-0 items-center gap-2.5 rounded-xl",
        "border border-border bg-card px-3 py-3 sm:gap-3 sm:px-4",
        "font-mono text-[13px] sm:text-sm",
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
      {/* No truncate — wrap on narrow, full command visible */}
      <code className="min-w-0 flex-1 whitespace-normal break-all text-foreground">
        {INSTALL_CMD}
      </code>
      <span
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          "transition-colors duration-200",
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

function DashboardCta({ className }: { className?: string }) {
  return (
    <Link
      href="/login"
      className={cn(
        "group inline-flex h-11 items-center justify-center gap-2",
        "rounded-xl bg-primary px-5",
        "text-sm font-semibold whitespace-nowrap text-primary-foreground",
        "shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.65)]",
        "transition-[transform,box-shadow,background-color] duration-200",
        "hover:bg-primary/90 hover:shadow-[0_10px_28px_-8px_hsl(var(--primary)/0.75)]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "active:translate-y-px",
        className,
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

function CommandStrip() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <FieldLabel>Check-in · install</FieldLabel>
          <p className="mt-0.5 text-xs text-muted-foreground">
            One command. Then board the dashboard.
          </p>
        </div>
        <span className="font-mono text-[9px] tracking-widest text-muted-foreground/45">
          GATE CLI
        </span>
      </div>

      <InstallCommand />

      {/* All secondary commands together */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border/70 bg-secondary/30 px-3 py-2.5">
          <FieldLabel>Sequence</FieldLabel>
          <ol
            className="mt-1.5 space-y-1 text-[13px] text-muted-foreground"
            aria-label="Boarding sequence"
          >
            <li className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] text-primary" aria-hidden="true">
                1
              </span>
              <span>
                <Code>pew login</Code>
                <span className="text-muted-foreground/65"> browser</span>
              </span>
            </li>
            <li className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] text-primary" aria-hidden="true">
                2
              </span>
              <span>
                <Code>pew init</Code>
                <span className="text-muted-foreground/65"> hooks</span>
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

        <div className="rounded-xl border border-border/70 bg-secondary/30 px-3 py-2.5">
          <FieldLabel>Gate codes</FieldLabel>
          <div className="mt-1.5 space-y-1 text-[13px] text-muted-foreground">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Code>pew sync</Code>
              <span className="text-muted-foreground/65">sync now</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Code>pew reset</Code>
              <span className="text-muted-foreground/65">re-scan</span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Code>pew update</Code>
              <span className="text-muted-foreground/65">latest</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-relaxed text-muted-foreground/60">
          Some agents lack a session-end hook — they board on the next{" "}
          <Code>pew sync</Code>.
        </p>
        <DashboardCta className="w-full sm:w-auto sm:min-w-[200px]" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Long boarding pass body
// ---------------------------------------------------------------------------

function TicketFace() {
  return (
    <div className="min-w-0 flex-[1.75] px-4 py-4 sm:px-5 sm:py-5">
      {/* Row 1 — identity + route (flat ticket face) */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 items-center gap-3 lg:max-w-[220px] lg:shrink-0">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary ring-1 ring-border sm:h-12 sm:w-12">
            <Image
              src="/logo-80.png"
              alt=""
              width={48}
              height={48}
              className="h-11 w-11 sm:h-12 sm:w-12"
              priority
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0">
            <FieldLabel>Passenger</FieldLabel>
            <h1 className="font-handwriting text-3xl leading-none tracking-tight text-foreground">
              pew
            </h1>
          </div>
        </div>

        <div className="hidden h-10 w-px shrink-0 bg-border lg:block" aria-hidden="true" />

        {/* Route — takes remaining width */}
        <div className="min-w-0 flex-1 rounded-xl border border-border/80 bg-secondary/35 px-3 py-2.5 sm:px-4">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            <Field label="From">
              <p className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                LCL
              </p>
              <p className="text-[11px] text-muted-foreground">Local logs</p>
            </Field>

            <div className="flex min-w-[4.5rem] flex-1 flex-col items-center gap-1 px-1 sm:min-w-[7rem]">
              <div className="flex w-full items-center gap-1.5">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-primary/40" />
                <SpaceshipIcon className="h-4 w-8 shrink-0 text-primary sm:h-5 sm:w-10" />
                <div className="h-px flex-1 bg-gradient-to-r from-primary/40 via-border to-transparent" />
              </div>
              <span className="font-mono text-[9px] tracking-[0.18em] text-muted-foreground/50">
                PEW-01
              </span>
            </div>

            <Field label="To" align="right">
              <p className="font-display text-xl font-bold tracking-tight text-primary sm:text-2xl">
                AIN
              </p>
              <p className="text-[11px] text-muted-foreground">AI Native</p>
            </Field>
          </div>
        </div>
      </div>

      {/* Row 2 — meta fields strip */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-y border-border/70 py-2.5 sm:grid-cols-4 sm:gap-4">
        <Field label="Class">
          <p className="font-display text-sm font-semibold text-foreground">AI Native</p>
        </Field>
        <Field label="Cabin">
          <p className="font-display text-sm font-semibold text-foreground">Local-first</p>
        </Field>
        <Field label="Flight">
          <p className="font-display text-sm font-semibold text-foreground">PEW</p>
        </Field>
        <Field label="Fleet">
          <p className="font-display text-sm font-semibold text-foreground">FULL</p>
        </Field>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        The contribution graph for AI-native devs — counts{" "}
        <span className="text-foreground">tokens</span>, never conversations.
      </p>

      {/* Row 3 — fleet chips full width of main face */}
      <div className="mt-3">
        <FieldLabel>Fleet · supported agents</FieldLabel>
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Supported agents">
          {AGENTS.map((source) => {
            const { color } = agentColor(source);
            return (
              <li key={source}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full",
                    "border border-border/80 bg-card px-2 py-0.5",
                    "text-[10px] font-medium text-foreground/90 sm:text-[11px]",
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

      {/* Row 4 — all commands in one place */}
      <div className="mt-4 border-t border-border/70 pt-4">
        <CommandStrip />
      </div>
    </div>
  );
}

function TicketStub() {
  return (
    <aside className="flex min-w-0 flex-col bg-secondary/35 px-4 py-4 sm:px-5 sm:py-5 lg:w-[200px] lg:shrink-0 xl:w-[220px]">
      <div className="mb-3 flex items-center justify-between gap-2 lg:flex-col lg:items-start">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
          Boarding stub
        </p>
        <span className="font-mono text-[9px] tracking-widest text-muted-foreground/45">
          KEEP
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 lg:grid-cols-1 lg:gap-4">
        <Field label="Gate">
          <p className="font-display text-xl font-bold text-foreground lg:text-2xl">CLI</p>
        </Field>
        <Field label="Seat">
          <p className="font-display text-xl font-bold text-foreground lg:text-2xl">
            {SEAT_CODE}
          </p>
        </Field>
        <Field label="Zone">
          <p className="font-display text-xl font-bold text-primary lg:text-2xl">NOW</p>
        </Field>
      </div>

      <div className="mt-4 border-t border-border/70 pt-4 lg:mt-auto">
        <FieldLabel>Ticket</FieldLabel>
        <p className="mt-0.5 font-mono text-xs text-foreground">PEW-TOKEN</p>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
          Cleared to board
        </p>
        <p className="mt-4 hidden text-[10px] leading-relaxed text-muted-foreground/55 lg:block">
          Board via the check-in panel — install, then enter dashboard.
        </p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

export function LandingContent() {
  return (
    <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-3 py-6 sm:px-5 sm:py-8 lg:py-10">
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
          {/*
            Long boarding pass: wide main face + narrow stub.
            All CLI commands live on the main face (not split across coupons).
          */}
          <div className="flex flex-col lg:flex-row lg:items-stretch">
            <TicketFace />

            <PassPerforation orientation="horizontal" className="lg:hidden" />
            <PassPerforation
              orientation="vertical"
              className="hidden py-4 lg:flex"
            />

            <TicketStub />
          </div>
        </PassCard>
      </div>
    </main>
  );
}
