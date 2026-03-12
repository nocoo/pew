import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export const metadata = {
  title: "Privacy Policy — pew",
  description:
    "How pew collects and handles your AI coding tool usage data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background p-2 md:p-4 flex items-center justify-center">
      <div className="mx-auto w-full max-w-2xl rounded-[16px] md:rounded-[20px] bg-card p-6 md:p-10">
        {/* Header */}
        <div className="space-y-4 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-5 w-5" strokeWidth={1.5} />
              </Link>
              <h1 className="text-2xl font-semibold text-foreground">
                Privacy Policy
              </h1>
            </div>
            <ThemeToggle />
          </div>
          <p className="text-sm text-muted-foreground">
            Last updated: March 12, 2026
          </p>
        </div>

        {/* Body */}
        <div className="space-y-6 text-sm">
          {/* Overview */}
          <section>
            <h3 className="font-semibold mb-2 text-base">Overview</h3>
            <p className="text-muted-foreground leading-relaxed">
              pew tracks AI coding tool usage statistics. It is designed to{" "}
              <strong className="text-foreground">never</strong> collect the
              content of your work — no prompts, no code, no project names, no
              file paths.
            </p>
          </section>

          {/* What we collect */}
          <section>
            <h3 className="font-semibold mb-2 text-base">
              What pew collects
            </h3>
            <p className="text-muted-foreground leading-relaxed mb-3">
               pew collects two categories of usage metadata from your local AI
              tool log files:
            </p>

            <h4 className="font-medium mb-1.5 text-sm text-foreground">
              Token usage (aggregated)
            </h4>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2 mb-3">
              <li>Which AI tool (e.g. Claude Code, Gemini CLI)</li>
              <li>Model name (e.g. claude-sonnet-4-20250514)</li>
              <li>
                Token counts (input, cached input, output, reasoning output)
              </li>
              <li>
                Time bucket — 30-minute window, not exact request timestamps
              </li>
              <li>Device ID — random UUID, not a hardware identifier</li>
            </ul>

            <h4 className="font-medium mb-1.5 text-sm text-foreground">
              Session metadata
            </h4>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2 mb-3">
              <li>Opaque session identifier from the AI tool</li>
              <li>Start and end timestamps, duration</li>
              <li>Message counts (user, assistant, total)</li>
              <li>Model used</li>
              <li>
                Project reference — a{" "}
                <strong className="text-foreground">
                  one-way SHA-256 hash
                </strong>
                , never a plaintext name or path
              </li>
            </ul>

            <h4 className="font-medium mb-1.5 text-sm text-foreground">
              Account information
            </h4>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
              <li>Email, display name, and profile photo from Google OAuth</li>
            </ul>
          </section>

          {/* Project references */}
          <section>
            <h3 className="font-semibold mb-2 text-base">
              Project references (hashed)
            </h3>
            <p className="text-muted-foreground leading-relaxed mb-2">
              pew groups sessions by project but never transmits project names
              or file paths. The process:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-1 ml-2">
              <li>
                Each parser extracts a raw project identifier (directory name,
                working directory, or upstream ID)
              </li>
              <li>
                The identifier is hashed:{" "}
                <code className="text-xs bg-accent px-1 py-0.5 rounded font-mono">
                  SHA-256(raw)[0:16]
                </code>{" "}
                — an irreversible 16-char hex string
              </li>
              <li>
                A defense-in-depth gateway re-hashes any value that doesn&apos;t
                match the expected format before upload
              </li>
            </ol>
          </section>

          {/* What we don't collect */}
          <section>
            <h3 className="font-semibold mb-2 text-base">
              What pew does NOT collect
            </h3>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
              <li>
                Conversation content — prompts, responses, tool calls, code
              </li>
              <li>File paths — hashed before transmission</li>
              <li>Project names — only opaque hashes are transmitted</li>
              <li>
                Code or repository content — pew reads only AI tool
                log/metadata files
              </li>
              <li>
                Hardware identifiers — Device ID is a random UUID
              </li>
            </ul>
          </section>

          {/* What stays local */}
          <section>
            <h3 className="font-semibold mb-2 text-base">
              What stays on your machine
            </h3>
            <p className="text-muted-foreground leading-relaxed mb-2">
              Several files are stored locally and never transmitted:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
              <li>
                Cursor state with file paths and byte offsets (
                <code className="text-xs bg-accent px-1 py-0.5 rounded font-mono">
                  ~/.config/pew/cursors.json
                </code>
                )
              </li>
              <li>Upload queue and API key configuration</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-2">
              pew <strong className="text-foreground">never</strong> modifies,
              deletes, or moves your AI tool log files. It only reads them.
            </p>
          </section>

          {/* Open source */}
          <section>
            <h3 className="font-semibold mb-2 text-base">Open source</h3>
            <p className="text-muted-foreground leading-relaxed">
              pew is open source under the MIT license. You can audit exactly
              what data is collected by reading the{" "}
              <a
                href="https://github.com/nicnocquee/pew"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                source code
              </a>
              .
            </p>
          </section>

          {/* Footer divider */}
          <div className="pt-4 border-t">
            <p className="text-muted-foreground text-xs">
              If you have questions about this policy, open an issue on{" "}
              <a
                href="https://github.com/nicnocquee/pew"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                GitHub
              </a>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
