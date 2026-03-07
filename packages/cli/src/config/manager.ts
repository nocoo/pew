import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { ZebraConfig } from "@zebra/core";

const PROD_CONFIG = "config.json";
const DEV_CONFIG = "config.dev.json";

/**
 * Manages the CLI configuration file.
 * Stored at ~/.config/zebra/config.json (prod) or config.dev.json (dev).
 */
export class ConfigManager {
  readonly configPath: string;

  constructor(configDir: string, dev = false) {
    const filename = dev ? DEV_CONFIG : PROD_CONFIG;
    this.configPath = join(configDir, filename);
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
