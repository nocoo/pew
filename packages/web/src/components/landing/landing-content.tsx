"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Copy, Terminal } from "lucide-react";
import { BADGE_CARD_SHADOW, PassHeader } from "@/components/brand/badge-card";
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

/** Tools without session-end hooks (synced on next `pew sync`). */
const NO_HOOK_LABELS =
  "GitHub Copilot CLI, Grok, Hermes, Kosmos, PM Studio, VS Code Copilot & ZCode";

// ---------------------------------------------------------------------------

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
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
        "group flex w-full min-w-0 items-center gap-2.5 rounded-xl",
        "border border-border bg-secondary px-3 py-3 sm:gap-3 sm:px-4",
        "font-mono text-[13px] sm:text-sm",
        "transition-colors duration-200 hover:bg-accent",
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
      <code className="min-w-0 flex-1 whitespace-normal break-all text-foreground">
        {INSTALL_CMD}
      </code>
      <span
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
          copied
            ? "bg-success/15 text-success"
            : "bg-card text-muted-foreground group-hover:text-foreground",
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

function AgentRoster() {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Supported agents">
      {AGENTS.map((source) => {
        const { color } = agentColor(source);
        return (
          <li key={source}>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full",
                "border border-border/80 bg-secondary/50 px-2.5 py-1",
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

export function LandingContent() {
  return (
    <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-4 py-8 sm:px-6 sm:py-10">
      <div
        className="animate-fade-up overflow-hidden rounded-2xl bg-card ring-1 ring-black/[0.08] dark:ring-white/[0.06]"
        style={{ boxShadow: BADGE_CARD_SHADOW, animationDelay: "40ms" }}
      >
        {/* Boarding-pass chrome lives in the header only */}
        <PassHeader
          badge="BOARDING PASS"
          destination="Destination · AI Native"
          meta="LOCAL-FIRST · READ-ONLY LOGS · TOKENS ONLY"
        />

        <div className="grid md:grid-cols-2 md:divide-x md:divide-border">
          {/* ── Product ──────────────────────────────────────────────── */}
          <section className="flex flex-col px-5 py-6 sm:px-6 sm:py-7">
            <div className="flex items-center gap-3.5">
              <Image
                src="/logo-80.png"
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 shrink-0"
                priority
                aria-hidden="true"
              />
              <div>
                <h1 className="font-handwriting text-4xl leading-none tracking-tight text-foreground">
                  pew
                </h1>
                <p className="mt-0.5 font-display text-sm font-medium text-muted-foreground">
                  AI coding token tracker
                </p>
              </div>
            </div>

            <h2 className="mt-5 font-display text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-[1.35rem]">
              The contribution graph for AI-native devs.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Reads local logs from your coding agents — counts{" "}
              <span className="text-foreground">tokens</span>, never conversations.
              Local-first. Privacy by default.
            </p>

            <div className="mt-6">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Supported agents
              </p>
              <AgentRoster />
            </div>
          </section>

          {/* ── Get started ──────────────────────────────────────────── */}
          <section className="flex flex-col border-t border-border px-5 py-6 sm:px-6 sm:py-7 md:border-t-0">
            <p className="text-xs font-medium text-muted-foreground">Get started</p>

            <div className="mt-3">
              <InstallCommand />
            </div>

            <ol
              className="mt-4 space-y-2 text-sm text-muted-foreground"
              aria-label="Quick start"
            >
              <li className="flex items-baseline gap-2.5">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[11px] font-semibold text-foreground"
                  aria-hidden="true"
                >
                  1
                </span>
                <span>
                  <Code>pew login</Code> — connect via browser
                </span>
              </li>
              <li className="flex items-baseline gap-2.5">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[11px] font-semibold text-foreground"
                  aria-hidden="true"
                >
                  2
                </span>
                <span>
                  <Code>pew init</Code> — install auto-sync hooks
                </span>
              </li>
              <li className="flex items-baseline gap-2.5">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[11px] font-semibold text-foreground"
                  aria-hidden="true"
                >
                  3
                </span>
                <span>Done — tokens sync after each session</span>
              </li>
            </ol>

            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/65">
              {NO_HOOK_LABELS} have no session-end hook — they sync on the next{" "}
              <Code>pew sync</Code>.
            </p>

            <Link
              href="/login"
              className={cn(
                "mt-5 inline-flex h-11 w-full items-center justify-center gap-2",
                "rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground",
                "shadow-[0_8px_24px_-10px_hsl(var(--primary)/0.65)]",
                "transition-[transform,box-shadow,background-color] duration-200",
                "hover:bg-primary/90",
                "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                "active:translate-y-px",
              )}
            >
              Enter dashboard
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>

            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Commands</p>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Code>pew sync</Code>
                  <span className="text-muted-foreground/75">sync now</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Code>pew status</Code>
                  <span className="text-muted-foreground/75">local summary</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Code>pew reset</Code>
                  <span className="text-muted-foreground/75">full re-scan</span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Code>pew update</Code>
                  <span className="text-muted-foreground/75">latest version</span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
