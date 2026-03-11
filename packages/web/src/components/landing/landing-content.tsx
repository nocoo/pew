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
          src="/logo-512.png"
          alt=""
          width={512}
          height={512}
          className="h-32 w-32 shrink-0"
          priority
          aria-hidden="true"
        />
        <div>
          <h1 className="font-handwriting text-5xl tracking-tight text-foreground">
            PEW
          </h1>
          <p className="font-display text-sm font-medium text-muted-foreground">
            Show your tokens
          </p>
        </div>
      </div>

      {/* Row 2: One-liner description */}
      <p
        className="mt-5 text-sm leading-relaxed text-muted-foreground animate-fade-up"
        style={{ animationDelay: "80ms" }}
      >
        The contribution graph for AI-native developers.
        Reads local logs from{" "}
        <span className="text-foreground">
          Claude Code, Codex, Gemini CLI, OpenCode
        </span>{" "}
        &amp; <span className="text-foreground">OpenClaw</span> — only
        counts, never conversations.
      </p>

      {/* Row 3: Install command — PRIMARY action */}
      <div
        className="mt-7 animate-fade-up"
        style={{ animationDelay: "160ms" }}
      >
        <InstallCommand />
      </div>

      {/* Row 4: Steps */}
      <ol
        className="mt-4 space-y-1 text-sm text-muted-foreground animate-fade-up"
        style={{ animationDelay: "240ms" }}
        aria-label="Getting started steps"
      >
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-primary" aria-hidden="true">
            1
          </span>
          <span>
            Run{" "}
            <code className="rounded bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-xs text-foreground">
              pew
            </code>{" "}
            to scan local logs
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-primary" aria-hidden="true">
            2
          </span>
          <span>
            Run{" "}
            <code className="rounded bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-xs text-foreground">
              pew login
            </code>{" "}
            to authenticate
          </span>
        </li>
        <li className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-primary" aria-hidden="true">
            3
          </span>
          <span>
            Run{" "}
            <code className="rounded bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-xs text-foreground">
              pew init
            </code>{" "}
            to install auto-sync plugins
          </span>
        </li>
      </ol>

      {/* Row 5: Sign In — secondary action */}
      <div
        className="mt-6 animate-fade-up"
        style={{ animationDelay: "320ms" }}
      >
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-[background-color,border-color] duration-200 hover:border-primary/40 hover:bg-primary/5"
        >
          Sign in to dashboard
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </main>
  );
}
