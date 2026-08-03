"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        "group relative flex w-full items-center gap-3 overflow-hidden rounded-xl",
        "border border-primary/35 bg-card px-4 py-4 sm:px-5",
        "font-mono text-[13px] sm:text-sm",
        "shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_8px_28px_-12px_hsl(var(--primary)/0.35)]",
        "transition-[border-color,background-color,box-shadow] duration-200",
        "hover:border-primary/55 hover:bg-primary/[0.04]",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "cursor-pointer text-left",
      )}
    >
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        aria-hidden="true"
      />
      <Terminal
        className="h-4 w-4 shrink-0 text-primary"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className="text-primary select-none" aria-hidden="true">
        $
      </span>
      <code className="min-w-0 flex-1 truncate text-foreground">{command}</code>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium",
          "transition-colors duration-200",
          copied
            ? "bg-success/15 text-success"
            : "bg-primary/10 text-primary group-hover:bg-primary/15",
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
                "shadow-[0_1px_0_hsl(var(--foreground)/0.03)]",
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

        {/* ── Right: install + dashboard CTAs ──────────────────────────── */}
        <div
          className="min-w-0 animate-fade-up"
          style={{ animationDelay: "140ms" }}
        >
          <div
            className={cn(
              "relative overflow-hidden rounded-2xl border border-border/80 bg-card",
              "p-5 sm:p-6",
              "shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_12px_40px_-16px_hsl(var(--primary)/0.18)]",
              "ring-1 ring-black/[0.04] dark:ring-white/[0.05]",
            )}
          >
            {/* Soft primary wash */}
            <div
              className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/[0.08] blur-3xl"
              aria-hidden="true"
            />

            <div className="relative space-y-5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
                  Get started
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  One install. Auto-sync after each session.
                </p>
              </div>

              <InstallCommand />

              <ol
                className="space-y-2 text-sm text-muted-foreground"
                aria-label="Quick start"
              >
                <li className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[11px] font-semibold text-primary"
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
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[11px] font-semibold text-primary"
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
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 font-mono text-[11px] font-semibold text-primary"
                    aria-hidden="true"
                  >
                    3
                  </span>
                  <span>Done — tokens sync automatically</span>
                </li>
              </ol>

              <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                GitHub Copilot CLI, Grok, Hermes, Kosmos, PM Studio, VS Code
                Copilot &amp; ZCode have no session-end hook — they sync on the
                next <Code>pew sync</Code>.
              </p>

              <div className="h-px w-full bg-border/80" />

              <Button
                asChild
                size="lg"
                className={cn(
                  "h-11 w-full rounded-xl text-sm font-semibold",
                  "shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.55)]",
                  "transition-[transform,box-shadow] duration-200",
                  "hover:shadow-[0_10px_28px_-8px_hsl(var(--primary)/0.65)]",
                  "active:translate-y-px",
                )}
              >
                <Link href="/login">
                  Enter dashboard
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>

              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
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
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
