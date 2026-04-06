import { ConfigManager as BaseConfigManager } from "@nocoo/cli-base";
import type { PewConfig } from "@pew/core";

const PROD_CONFIG = "config.json";
const DEV_CONFIG = "config.dev.json";

/**
 * Pew-specific configuration manager.
 * Extends cli-base ConfigManager with pew-specific helpers.
 *
 * - Production: ~/.config/pew/config.json
 * - Dev:        ~/.config/pew/config.dev.json
 * - Device ID:  ~/.config/pew/device.json (shared across dev/prod)
 */
export class ConfigManager extends BaseConfigManager<PewConfig> {
  constructor(configDir: string, dev = false) {
    super(configDir, dev, {
      prodFilename: PROD_CONFIG,
      devFilename: DEV_CONFIG,
    });
  }

  /** Load config from disk (async). Alias for readAsync(). */
  load(): Promise<PewConfig> {
    return this.readAsync();
  }

  /** Save config to disk. Note: this merges with existing config. */
  save(config: PewConfig): Promise<void> {
    return this.writeAsync(config);
  }

  /** Get the authentication token. */
  getToken(): string | undefined {
    return this.get("token") as string | undefined;
  }

  /** Check if user is logged in. */
  isLoggedIn(): boolean {
    return !!this.getToken();
  }
}
