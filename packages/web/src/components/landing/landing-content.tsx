"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Copy, Terminal } from "lucide-react";
import { BadgeCard } from "@/components/brand/badge-card";
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

// ---------------------------------------------------------------------------
// Install command — PRIMARY CTA for a CLI tool
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
        "group flex w-full items-center gap-3 rounded-xl",
        "border border-border bg-secondary px-4 py-3.5",
        "font-mono text-[13px] sm:text-sm",
        "transition-colors duration-200",
        "hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "cursor-pointer text-left",
      )}
    >
      <Terminal
        className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="select-none text-muted-foreground" aria-hidden="true">
        $
      </span>
      <code className="min-w-0 flex-1 truncate text-foreground">{command}</code>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium",
          "transition-colors duration-200",
          copied
            ? "bg-success/15 text-success"
            : "bg-background/80 text-muted-foreground group-hover:text-foreground",
        )}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            Copied
          </>
        ) : (
          <>
            <Copy className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Copy
          </>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline code snippet
// ---------------------------------------------------------------------------

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
  );
}

// ---------------------------------------------------------------------------
// Supported agents — color chips from palette
// ---------------------------------------------------------------------------

function AgentRoster() {
  return (
    <ul
      className="flex flex-wrap gap-1.5"
      aria-label={`${AGENTS.length} supported agents`}
    >
      {AGENTS.map((source) => {
        const { color } = agentColor(source);
        return (
          <li key={source}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full",
                "border border-border/80 bg-card/80 px-2.5 py-1",
                "text-[11px] font-medium text-foreground/90",
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
  );
}

// ---------------------------------------------------------------------------
// Main landing — centered two-column split
// ---------------------------------------------------------------------------

export function LandingContent() {
  return (
    <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-10 sm:py-12">
      <div className="grid items-center gap-10 md:grid-cols-2 md:gap-12 lg:gap-16">
        {/* ── Left: brand + agents ─────────────────────────────────────── */}
        <div className="min-w-0">
          <div
            className="flex items-center gap-4 animate-fade-up"
            style={{ animationDelay: "0ms" }}
          >
            <Image
              src="/logo-80.png"
              alt=""
              width={72}
              height={72}
              className="h-[72px] w-[72px] shrink-0"
              priority
              aria-hidden="true"
            />
            <div>
              <h1 className="font-handwriting text-5xl leading-none tracking-tight text-foreground sm:text-6xl">
                pew
              </h1>
              <p className="mt-1 font-display text-sm font-medium tracking-wide text-muted-foreground">
                Show your tokens
              </p>
            </div>
          </div>

          <h2
            className="mt-7 max-w-md font-display text-2xl font-semibold leading-snug tracking-tight text-foreground sm:text-[1.75rem] animate-fade-up"
            style={{ animationDelay: "60ms" }}
          >
            The contribution graph for AI-native devs.
          </h2>

          <p
            className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground animate-fade-up"
            style={{ animationDelay: "120ms" }}
          >
            Reads local logs from your coding agents — counts{" "}
            <span className="text-foreground">tokens</span>, never conversations.
            Local-first. Privacy by default.
          </p>

          <div
            className="mt-7 animate-fade-up"
            style={{ animationDelay: "180ms" }}
          >
            <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
              {AGENTS.length} agents supported
            </p>
            <AgentRoster />
          </div>
        </div>

        {/* ── Right: badge card CTA (matches login chrome) ─────────────── */}
        <div
          className="min-w-0 animate-fade-up"
          style={{ animationDelay: "140ms" }}
        >
          <BadgeCard
            badge="CLI"
            contentClassName="px-5 pt-5 pb-5 sm:px-6 sm:pt-6"
            footer={
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                <span className="text-[10px] text-muted-foreground">
                  Local-first · Ready
                </span>
              </div>
            }
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
              Get started
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              One install. Auto-sync after each session.
            </p>

            <div className="mt-4">
              <InstallCommand />
            </div>

            <ol
              className="mt-4 space-y-2 text-sm text-muted-foreground"
              aria-label="Quick start"
            >
              <li className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[11px] font-semibold text-foreground"
                  aria-hidden="true"
                >
                  1
                </span>
                <span>
                  <Code>pew login</Code> — sign in via browser
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[11px] font-semibold text-foreground"
                  aria-hidden="true"
                >
                  2
                </span>
                <span>
                  <Code>pew init</Code> — install auto-sync hooks
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[11px] font-semibold text-foreground"
                  aria-hidden="true"
                >
                  3
                </span>
                <span>Done — tokens sync automatically</span>
              </li>
            </ol>

            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/60">
              GitHub Copilot CLI, Grok, Hermes, Kosmos, PM Studio, VS Code Copilot
              &amp; ZCode have no session-end hook — they sync on the next{" "}
              <Code>pew sync</Code>.
            </p>

            <div className="mt-5 h-px w-full bg-border" />

            <Link
              href="/login"
              className={cn(
                "mt-5 flex w-full items-center justify-center gap-2",
                "rounded-xl bg-secondary px-4 py-3",
                "text-sm font-medium text-foreground",
                "transition-colors hover:bg-accent",
              )}
            >
              Enter dashboard
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>

            <div className="mt-5">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                Handy commands
              </p>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <Code>pew sync</Code>
                  <span className="text-muted-foreground/75">sync right now</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <Code>pew reset</Code>
                  <span className="text-muted-foreground/75">
                    wipe local state, re-scan
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <Code>pew update</Code>
                  <span className="text-muted-foreground/75">
                    grab the latest version
                  </span>
                </div>
              </div>
            </div>
          </BadgeCard>
        </div>
      </div>
    </main>
  );
}
