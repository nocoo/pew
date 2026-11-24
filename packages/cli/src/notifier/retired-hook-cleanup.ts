import { readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { NotifierOperationResult } from "@pew/core";

export async function cleanupRetiredHooks(
  home: string,
  notifyPath: string,
  env = process.env,
): Promise<NotifierOperationResult[]> {
  const settings = join(
    env.GEMINI_HOME?.trim() ? resolve(env.GEMINI_HOME.trim()) : join(home, ".gemini"),
    "settings.json",
  );
  const extension = join(home, ".omp", "agent", "extensions", "pew-sync.ts");
  const results: NotifierOperationResult[] = [];
  for (const [source, path] of [
    ["gemini-cli", settings],
    ["omp", extension],
  ] as const) {
    try {
      const raw = await readFile(path, "utf8");
      let changed = false;
      if (source === "omp") {
        const owned =
          raw ===
          `// PEW_OMP_HOOK \u2014 managed by pew, do not edit
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { spawn } from "node:child_process";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async () => {
    try {
      const child = spawn("node", [${JSON.stringify(notifyPath)}, "--source=omp"], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {}
  });
}
`;
        if (owned) {
          await unlink(path);
          changed = true;
        } else if (raw.includes(notifyPath) || raw.includes(JSON.stringify(notifyPath)))
          throw new Error("Retired hook ownership conflict");
      } else {
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object" || Array.isArray(data))
          throw new Error("Invalid retired hook settings");
        if (
          data.hooks !== undefined &&
          (!data.hooks || typeof data.hooks !== "object" || Array.isArray(data.hooks))
        )
          throw new Error("Invalid retired hook settings");
        const entries = data.hooks?.SessionEnd;
        if (entries !== undefined && !Array.isArray(entries))
          throw new Error("Invalid retired hook settings");
        const quoted = /^[A-Za-z0-9_\-./:@]+$/.test(notifyPath)
          ? notifyPath
          : `"${notifyPath.replace(/"/g, '\\"')}"`;
        const command = `/usr/bin/env node ${quoted} --source=gemini-cli`;
        const next = (entries ?? []).flatMap((entry: Record<string, unknown>) => {
          if (!entry || !Array.isArray(entry.hooks)) return [entry];
          const hooks = entry.hooks.filter(
            (hook: { name?: string; type?: string; command?: string } | null) => {
              if (
                typeof hook?.command === "string" &&
                (hook.command.includes(notifyPath) || hook.command.includes(quoted)) &&
                (hook.command !== command || hook.type !== "command")
              )
                throw new Error("Retired hook ownership conflict");
              return !(hook?.type === "command" && hook.command === command);
            },
          );
          if (hooks.length === entry.hooks.length) return [entry];
          changed = true;
          return hooks.length ? [{ ...entry, hooks }] : [];
        });
        if (changed) {
          const { SessionEnd: _removed, ...otherHooks } = data.hooks;
          const hooks = next.length ? { ...otherHooks, SessionEnd: next } : otherHooks;
          const { hooks: _old, ...otherSettings } = data;
          const updated = Object.keys(hooks).length ? { ...otherSettings, hooks } : otherSettings;
          await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
        }
      }
      if (changed)
        results.push({
          source,
          action: "uninstall",
          changed: true,
          detail: "Retired Pew hook removed",
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      results.push({
        source,
        action: "skip",
        changed: false,
        detail: error instanceof Error ? error.message : String(error),
        warnings: ["Retired hook cleanup failed; shared dispatcher preserved"],
      });
    }
  }
  return results;
}
