"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Copy, Check } from "lucide-react";

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
      onClick={handleCopy}
      aria-label={`Copy install command: ${command}`}
      className="group flex w-full items-center gap-3 rounded-lg bg-foreground/[0.04] px-5 py-3.5 font-mono text-base transition-[background-color] duration-200 hover:bg-foreground/[0.08] cursor-pointer"
    >
      <span className="text-primary select-none" aria-hidden="true">
        $
      </span>
      <code className="flex-1 text-left text-foreground">{command}</code>
      {copied ? (
        <Check
          className="h-4 w-4 text-success shrink-0"
          strokeWidth={2}
          aria-hidden="true"
        />
      ) : (
        <Copy
          className="h-4 w-4 text-muted-foreground group-hover:text-foreground shrink-0 transition-[color] duration-200"
          strokeWidth={2}
          aria-hidden="true"
        />
      )}
      <span className="sr-only">{copied ? "Copied" : "Click to copy"}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline code snippet
// ---------------------------------------------------------------------------

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

// ---------------------------------------------------------------------------
// Main landing — single viewport, centered, no scroll
// ---------------------------------------------------------------------------

export function LandingContent() {
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col justify-center px-6">
      {/* Row 1: Logo + product name side by side */}
      <div
        className="flex items-center gap-4 animate-fade-up"
        style={{ animationDelay: "0ms" }}
      >
        <Image
          src="/logo-80.png"
          alt=""
          width={80}
          height={80}
          className="h-20 w-20 shrink-0"
          priority
          aria-hidden="true"
        />
        <div>
          <h1 className="font-handwriting text-5xl tracking-tight text-foreground">
            pew
          </h1>
          <p className="font-display text-sm font-medium text-muted-foreground">
            Show your tokens
          </p>
        </div>
      </div>

      {/* Row 2: One-liner */}
      <p
        className="mt-5 text-sm leading-relaxed text-muted-foreground animate-fade-up"
        style={{ animationDelay: "80ms" }}
      >
        The contribution graph for AI-native devs.
        Reads local logs from{" "}
        <span className="text-foreground">
          Claude Code, Codex, Gemini CLI, Hermes, Kosmos, OpenCode, OpenClaw, Pi,
          VS Code Copilot, GitHub Copilot CLI
        </span>{" "}
        — counts tokens, never conversations.
      </p>

      {/* Row 3: Install command */}
      <div
        className="mt-7 animate-fade-up"
        style={{ animationDelay: "160ms" }}
      >
        <InstallCommand />
      </div>

      {/* Row 4: Quick start */}
      <ol
        className="mt-4 space-y-1 text-sm text-muted-foreground animate-fade-up"
        style={{ animationDelay: "240ms" }}
        aria-label="Quick start"
      >
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-primary" aria-hidden="true">
            1
          </span>
          <span>
            <Code>pew login</Code> — sign in via browser
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-primary" aria-hidden="true">
            2
          </span>
          <span>
            <Code>pew init</Code> — install auto-sync hooks{" "}
            <span className="text-muted-foreground/60">(runs sync on every session end; Hermes &amp; Kosmos require manual plugin setup)</span>
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-primary" aria-hidden="true">
            3
          </span>
          <span>
            Done! Your tokens sync automatically.
          </span>
        </li>
      </ol>

      {/* Row 5: Handy commands */}
      <div
        className="mt-5 animate-fade-up"
        style={{ animationDelay: "300ms" }}
      >
        <p className="mb-2 text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">
          Handy commands
        </p>
        <div className="space-y-0.5 text-sm text-muted-foreground">
          <div className="flex items-baseline gap-2">
            <Code>pew sync</Code>
            <span className="text-muted-foreground/80">— sync right now</span>
          </div>
          <div className="flex items-baseline gap-2">
            <Code>pew reset</Code>
            <span className="text-muted-foreground/80">— wipe local state, re-scan from scratch</span>
          </div>
          <div className="flex items-baseline gap-2">
            <Code>pew update</Code>
            <span className="text-muted-foreground/80">— grab the latest version</span>
          </div>
        </div>
      </div>

      {/* Row 6: Sign In */}
      <div
        className="mt-6 animate-fade-up"
        style={{ animationDelay: "360ms" }}
      >
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-[background-color,border-color] duration-200 hover:border-primary/40 hover:bg-primary/5"
        >
          Sign in to dashboard
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </main>
  );
}
