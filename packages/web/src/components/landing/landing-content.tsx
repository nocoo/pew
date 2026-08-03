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

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {children}
    </code>
  );
}

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
                "border border-border/80 bg-secondary/60 px-2.5 py-1",
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

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[11px] font-semibold text-foreground"
        aria-hidden="true"
      >
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Landing — single Token Pass (boarding-pass metaphor)
// ---------------------------------------------------------------------------

export function LandingContent() {
  return (
    <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-4 py-10 sm:px-6 sm:py-12">
      <div className="animate-fade-up" style={{ animationDelay: "40ms" }}>
        <PassCard
          badge="TOKEN PASS"
          meta={`${AGENTS.length} AGENTS · LOCAL-FIRST`}
          footer={
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <div className="flex items-center gap-1.5">
                <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                <span className="text-[10px] text-muted-foreground">Ready</span>
              </div>
              <span className="text-muted-foreground/30" aria-hidden="true">
                ·
              </span>
              <span className="text-[10px] text-muted-foreground">
                Counts tokens, never conversations
              </span>
              <span className="text-muted-foreground/30" aria-hidden="true">
                ·
              </span>
              <span className="text-[10px] text-muted-foreground">
                Privacy by default
              </span>
            </div>
          }
        >
          {/* Two panels inside one pass — stub perforation on md+ */}
          <div className="relative flex flex-col md:flex-row">
            {/* LEFT panel — identity / route */}
            <section className="min-w-0 flex-1 px-5 py-6 sm:px-7 sm:py-7">
              <div className="flex items-center gap-3.5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary ring-1 ring-border sm:h-16 sm:w-16">
                  <Image
                    src="/logo-80.png"
                    alt=""
                    width={64}
                    height={64}
                    className="h-14 w-14 sm:h-16 sm:w-16"
                    priority
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                    Passenger
                  </p>
                  <h1 className="font-handwriting text-4xl leading-none tracking-tight text-foreground sm:text-5xl">
                    pew
                  </h1>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 border-y border-border/70 py-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
                    From
                  </p>
                  <p className="mt-0.5 font-display text-sm font-semibold text-foreground">
                    Local logs
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
                    To
                  </p>
                  <p className="mt-0.5 font-display text-sm font-semibold text-foreground">
                    Your graph
                  </p>
                </div>
              </div>

              <h2 className="mt-5 font-display text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-[1.35rem]">
                The contribution graph for AI-native devs.
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Reads agent session logs on your machine — counts{" "}
                <span className="text-foreground">tokens</span>, never
                conversations.
              </p>

              <div className="mt-5">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
                  Agents on this pass
                </p>
                <AgentRoster />
              </div>
            </section>

            <PassPerforation className="self-stretch py-6" />
            {/* Mobile divider */}
            <div
              className="mx-5 border-t border-dashed border-border md:hidden"
              aria-hidden="true"
            />

            {/* RIGHT panel — boarding / actions */}
            <section className="min-w-0 flex-1 px-5 py-6 sm:px-7 sm:py-7">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground/70">
                Boarding
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
                <Step n={1}>
                  <Code>pew login</Code> — sign in via browser
                </Step>
                <Step n={2}>
                  <Code>pew init</Code> — install auto-sync hooks
                </Step>
                <Step n={3}>Done — tokens sync automatically</Step>
              </ol>

              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/60">
                GitHub Copilot CLI, Grok, Hermes, Kosmos, PM Studio, VS Code
                Copilot &amp; ZCode have no session-end hook — they sync on the
                next <Code>pew sync</Code>.
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
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
                  Gate codes
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
            </section>
          </div>
        </PassCard>
      </div>
    </main>
  );
}
