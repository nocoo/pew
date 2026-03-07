import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "../config/manager.js";

describe("ConfigManager", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-config-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return empty config when no file exists", async () => {
    const manager = new ConfigManager(tempDir);
    const config = await manager.load();
    expect(config).toEqual({});
  });

  it("should save and load token", async () => {
    const manager = new ConfigManager(tempDir);
    await manager.save({ token: "zb_abc123" });
    const loaded = await manager.load();
    expect(loaded.token).toBe("zb_abc123");
  });

  it("should create config directory if it does not exist", async () => {
    const configDir = join(tempDir, "nested", "config");
    const manager = new ConfigManager(configDir);
    await manager.save({ token: "test-token" });
    const loaded = await manager.load();
    expect(loaded.token).toBe("test-token");
  });

  it("should write valid JSON to disk", async () => {
    const manager = new ConfigManager(tempDir);
    await manager.save({ token: "zb_abc123" });
    const raw = await readFile(join(tempDir, "config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.token).toBe("zb_abc123");
  });

  it("should overwrite on subsequent saves", async () => {
    const manager = new ConfigManager(tempDir);
    await manager.save({ token: "first" });
    await manager.save({ token: "second" });
    const config = await manager.load();
    expect(config.token).toBe("second");
  });

  it("should expose configPath", () => {
    const manager = new ConfigManager(tempDir);
    expect(manager.configPath).toBe(join(tempDir, "config.json"));
  });

  it("should handle corrupted config file gracefully", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(tempDir, "config.json"), "not valid json{{{");
    const manager = new ConfigManager(tempDir);
    const config = await manager.load();
    expect(config).toEqual({});
  });
});
