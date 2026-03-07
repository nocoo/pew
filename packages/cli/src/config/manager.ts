import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { ZebraConfig } from "@zebra/core";

const CONFIG_FILE = "config.json";

/**
 * Manages the CLI configuration file.
 * Stored at ~/.config/zebra/config.json
 */
export class ConfigManager {
  readonly configPath: string;

  constructor(configDir: string) {
    this.configPath = join(configDir, CONFIG_FILE);
  }

  /** Load config from disk. Returns empty config if file doesn't exist or is corrupted. */
  async load(): Promise<ZebraConfig> {
    try {
      const raw = await readFile(this.configPath, "utf-8");
      return JSON.parse(raw) as ZebraConfig;
    } catch {
      return {};
    }
  }

  /** Save config to disk, creating the directory if needed. */
  async save(config: ZebraConfig): Promise<void> {
    const dir = dirname(this.configPath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify(config, null, 2) + "\n");
  }
}
