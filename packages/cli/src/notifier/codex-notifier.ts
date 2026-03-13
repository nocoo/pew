import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { NotifierOperationResult, NotifierStatus } from "@pew/core";

interface CodexNotifierFs {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  writeFile: (path: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<unknown>;
}

export interface CodexNotifierOptions {
  configPath: string;
  notifyPath: string;
  originalBackupPath: string;
  fs?: CodexNotifierFs;
}

const SOURCE = "codex";

export async function installCodexNotifier(
  opts: CodexNotifierOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const text = await readOptional(opts.configPath, fs);
  if (text === null) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Codex config.toml not found",
    };
  }

  const notify = buildNotifyCommand(opts.notifyPath);
  const existingNotify = extractNotify(text);
  if (arraysEqual(existingNotify, notify)) {
    return {
      source: SOURCE,
      action: "install",
      changed: false,
      detail: "Codex notifier already installed",
    };
  }

  if (existingNotify && existingNotify.length > 0) {
    const existingBackup = await readOptional(opts.originalBackupPath, fs);
    if (existingBackup === null) {
      await fs.mkdir(dirname(opts.originalBackupPath), { recursive: true });
      await fs.writeFile(
        opts.originalBackupPath,
        `${JSON.stringify({ notify: existingNotify, capturedAt: new Date().toISOString() }, null, 2)}\n`,
        "utf8",
      );
    }
  }

  const updated = setNotify(text, notify);
  const backupPath = `${opts.configPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.writeFile(backupPath, text, "utf8");
  await fs.writeFile(opts.configPath, updated, "utf8");

  return {
    source: SOURCE,
    action: "install",
    changed: true,
    detail: "Codex notifier installed",
    backupPath,
  };
}

export async function uninstallCodexNotifier(
  opts: CodexNotifierOptions,
): Promise<NotifierOperationResult> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const text = await readOptional(opts.configPath, fs);
  if (text === null) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Codex config.toml not found",
    };
  }

  const existingNotify = extractNotify(text);
  const expectedNotify = buildNotifyCommand(opts.notifyPath);
  if (!arraysEqual(existingNotify, expectedNotify)) {
    return {
      source: SOURCE,
      action: "skip",
      changed: false,
      detail: "Codex notifier not installed",
    };
  }

  const originalBackup = await readOptional(opts.originalBackupPath, fs);
  const originalNotify = originalBackup
    ? (JSON.parse(originalBackup) as { notify?: string[] }).notify ?? null
    : null;
  const updated = originalNotify ? setNotify(text, originalNotify) : removeNotify(text);

  const backupPath = `${opts.configPath}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.writeFile(backupPath, text, "utf8");
  await fs.writeFile(opts.configPath, updated, "utf8");

  return {
    source: SOURCE,
    action: "uninstall",
    changed: true,
    detail: originalNotify ? "Codex notifier restored" : "Codex notifier removed",
    backupPath,
  };
}

export async function getCodexNotifierStatus(
  opts: CodexNotifierOptions,
): Promise<NotifierStatus> {
  const fs = opts.fs ?? { readFile, writeFile, mkdir };
  const text = await readOptional(opts.configPath, fs);
  if (text === null) return "not-installed";
  return arraysEqual(extractNotify(text), buildNotifyCommand(opts.notifyPath))
    ? "installed"
    : "not-installed";
}

function buildNotifyCommand(notifyPath: string): string[] {
  return ["/usr/bin/env", "node", notifyPath, "--source=codex"];
}

async function readOptional(
  filePath: string,
  fs: CodexNotifierFs,
): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw err;
  }
}

function extractNotify(text: string): string[] | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*notify\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const rhs = (match[1] ?? "").trim();
    const literal = readTomlArrayLiteral(lines, i, rhs);
    if (!literal) continue;
    return parseTomlStringArray(literal);
  }
  return null;
}

function setNotify(text: string, notify: string[]): string {
  const lines = text.split(/\r?\n/);
  const replacement = `notify = ${formatTomlStringArray(notify)}`;
  const out: string[] = [];
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*notify\s*=\s*(.*)\s*$/);
    if (!match) {
      out.push(lines[i]);
      continue;
    }

    if (!replaced) {
      out.push(replacement);
      replaced = true;
    }

    i = findTomlArrayBlockEnd(lines, i, (match[1] ?? "").trim());
  }

  if (!replaced) {
    const firstTableIndex = out.findIndex((line) => /^\s*\[/.test(line));
    const insertAt = firstTableIndex === -1 ? out.length : firstTableIndex;
    out.splice(insertAt, 0, replacement);
  }

  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

function removeNotify(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*notify\s*=\s*(.*)\s*$/);
    if (!match) {
      out.push(lines[i]);
      continue;
    }

    i = findTomlArrayBlockEnd(lines, i, (match[1] ?? "").trim());
  }

  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * Parse a TOML string array literal, e.g. `["a", "b", 'c']`.
 *
 * Handles all TOML escape sequences in double-quoted strings:
 *   `\"` `\\` `\n` `\t` `\r` `\b` `\f` `\uXXXX` `\UXXXXXXXX`
 *
 * Single-quoted strings are literal (no escape processing), per the TOML spec.
 */
function parseTomlStringArray(text: string): string[] | null {
  if (!text.startsWith("[") || !text.endsWith("]")) return null;
  const inner = text.slice(1, -1).trim();
  if (!inner) return [];

  const parts: string[] = [];
  let current = "";
  let inString = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (!inString) {
      if (char === '"' || char === "'") {
        inString = true;
        quote = char;
        current = "";
      }
      continue;
    }

    // Handle backslash escapes in double-quoted strings only
    if (quote === '"' && char === "\\") {
      const next = inner[i + 1];
      if (next === '"') { current += '"'; i++; continue; }
      if (next === "\\") { current += "\\"; i++; continue; }
      if (next === "n") { current += "\n"; i++; continue; }
      if (next === "t") { current += "\t"; i++; continue; }
      if (next === "r") { current += "\r"; i++; continue; }
      if (next === "b") { current += "\b"; i++; continue; }
      if (next === "f") { current += "\f"; i++; continue; }

      // \uXXXX — 4-digit Unicode escape
      if (next === "u") {
        const hex = inner.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          current += String.fromCodePoint(parseInt(hex, 16));
          i += 5; // skip \uXXXX
          continue;
        }
      }

      // \UXXXXXXXX — 8-digit Unicode escape
      if (next === "U") {
        const hex = inner.slice(i + 2, i + 10);
        if (/^[0-9a-fA-F]{8}$/.test(hex)) {
          const codePoint = parseInt(hex, 16);
          if (codePoint <= 0x10FFFF) {
            current += String.fromCodePoint(codePoint);
            i += 9; // skip \UXXXXXXXX
            continue;
          }
        }
      }

      // Unknown escape: preserve the backslash as-is (defensive)
      current += char;
      continue;
    }

    if (char === quote) {
      parts.push(current);
      inString = false;
      quote = null;
      continue;
    }

    current += char;
  }

  return parts.length > 0 ? parts : null;
}

function formatTomlStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function readTomlArrayLiteral(
  lines: string[],
  startIndex: number,
  rhs: string,
): string | null {
  if (!rhs.startsWith("[")) return null;

  let depth = 0;
  let inString = false;
  let quote: '"' | "'" | null = null;
  const chunks: string[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const chunk = i === startIndex ? rhs : lines[i];
    chunks.push(chunk.trim());

    for (let j = 0; j < chunk.length; j++) {
      const char = chunk[j];
      if (!inString) {
        if (char === '"' || char === "'") {
          inString = true;
          quote = char;
          continue;
        }
        if (char === "[") depth += 1;
        else if (char === "]") depth -= 1;
        continue;
      }

      // Skip escaped characters in double-quoted strings
      if (quote === '"' && char === "\\" && j + 1 < chunk.length) {
        j++; // skip the next character
        continue;
      }

      if (char === quote) {
        inString = false;
        quote = null;
      }
    }

    if (depth === 0) return chunks.join(" ");
  }

  return null;
}

function findTomlArrayBlockEnd(lines: string[], startIndex: number, rhs: string): number {
  if (!rhs.startsWith("[")) return startIndex;

  let depth = 0;
  let inString = false;
  let quote: '"' | "'" | null = null;

  for (let i = startIndex; i < lines.length; i++) {
    const chunk = i === startIndex ? rhs : lines[i];
    for (let j = 0; j < chunk.length; j++) {
      const char = chunk[j];
      if (!inString) {
        if (char === '"' || char === "'") {
          inString = true;
          quote = char;
          continue;
        }
        if (char === "[") depth += 1;
        else if (char === "]") depth -= 1;
        continue;
      }
      // Skip escaped characters in double-quoted strings
      if (quote === '"' && char === "\\" && j + 1 < chunk.length) {
        j++;
        continue;
      }
      if (char === quote) {
        inString = false;
        quote = null;
      }
    }
    if (depth === 0) return i;
  }

  return startIndex;
}

function arraysEqual(left: string[] | null, right: string[]): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
