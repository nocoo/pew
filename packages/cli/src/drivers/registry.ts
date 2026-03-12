/**
 * Driver Registry — single entry point for constructing active driver sets.
 *
 * Returns drivers for enabled sources based on which directories/DB paths
 * exist in the provided options. File-based drivers are singletons;
 * DB-based drivers are constructed via factory functions (need DI params).
 *
 * The orchestrator (sync.ts / session-sync.ts) calls these once per run
 * and iterates the returned arrays with generic loops.
 */

import type { FileCursorBase, SessionFileCursor } from "@pew/core";
import type {
  DiscoverOpts,
  FileTokenDriver,
  DbTokenDriver,
  FileSessionDriver,
  DbSessionDriver,
} from "./types.js";

// -- Token driver singletons --
import { claudeTokenDriver } from "./token/claude-token-driver.js";
import { geminiTokenDriver } from "./token/gemini-token-driver.js";
import { openCodeJsonTokenDriver } from "./token/opencode-json-token-driver.js";
import { openClawTokenDriver } from "./token/openclaw-token-driver.js";
import { codexTokenDriver } from "./token/codex-token-driver.js";
import { vscodeCopilotTokenDriver } from "./token/vscode-copilot-token-driver.js";
import {
  createOpenCodeSqliteTokenDriver,
  type OpenCodeSqliteTokenDriverOpts,
} from "./token/opencode-sqlite-token-driver.js";

// -- Session driver singletons --
import { claudeSessionDriver } from "./session/claude-session-driver.js";
import { geminiSessionDriver } from "./session/gemini-session-driver.js";
import { openCodeJsonSessionDriver } from "./session/opencode-json-session-driver.js";
import { openClawSessionDriver } from "./session/openclaw-session-driver.js";
import { codexSessionDriver } from "./session/codex-session-driver.js";
import {
  createOpenCodeSqliteSessionDriver,
  type OpenCodeSqliteSessionDriverOpts,
} from "./session/opencode-sqlite-session-driver.js";

// ---------------------------------------------------------------------------
// Token driver registry options
// ---------------------------------------------------------------------------

/**
 * Options for constructing the token driver set.
 *
 * Directory fields control which file-based drivers are included.
 * DB fields control the SQLite driver (requires both path + opener).
 */
export interface TokenDriverRegistryOpts {
  claudeDir?: string;
  geminiDir?: string;
  openCodeMessageDir?: string;
  openclawDir?: string;
  codexSessionsDir?: string;
  vscodeCopilotDirs?: string[];
  openCodeDbPath?: string;
  openMessageDb?: OpenCodeSqliteTokenDriverOpts["openMessageDb"];
}

export interface TokenDriverSet {
  fileDrivers: FileTokenDriver<FileCursorBase>[];
  dbDrivers: DbTokenDriver[];
}

/**
 * Construct the active token driver set based on which sources are available.
 *
 * A file driver is included when its corresponding directory option is truthy.
 * The SQLite DB driver is included when both `openCodeDbPath` and `openMessageDb` are provided.
 */
export function createTokenDrivers(opts: TokenDriverRegistryOpts): TokenDriverSet {
  const fileDrivers: FileTokenDriver<FileCursorBase>[] = [];
  const dbDrivers: DbTokenDriver[] = [];

  if (opts.claudeDir) {
    fileDrivers.push(claudeTokenDriver);
  }
  if (opts.codexSessionsDir) {
    fileDrivers.push(codexTokenDriver);
  }
  if (opts.geminiDir) {
    fileDrivers.push(geminiTokenDriver);
  }
  if (opts.openCodeMessageDir) {
    fileDrivers.push(openCodeJsonTokenDriver);
  }
  if (opts.openclawDir) {
    fileDrivers.push(openClawTokenDriver);
  }
  if (opts.vscodeCopilotDirs && opts.vscodeCopilotDirs.length > 0) {
    fileDrivers.push(vscodeCopilotTokenDriver);
  }
  if (opts.openCodeDbPath && opts.openMessageDb) {
    dbDrivers.push(
      createOpenCodeSqliteTokenDriver({
        dbPath: opts.openCodeDbPath,
        openMessageDb: opts.openMessageDb,
      }),
    );
  }

  return { fileDrivers, dbDrivers };
}

// ---------------------------------------------------------------------------
// Session driver registry options
// ---------------------------------------------------------------------------

/**
 * Options for constructing the session driver set.
 */
export interface SessionDriverRegistryOpts {
  claudeDir?: string;
  geminiDir?: string;
  openCodeMessageDir?: string;
  openclawDir?: string;
  codexSessionsDir?: string;
  openCodeDbPath?: string;
  openSessionDb?: OpenCodeSqliteSessionDriverOpts["openSessionDb"];
}

export interface SessionDriverSet {
  fileDrivers: FileSessionDriver<SessionFileCursor | unknown>[];
  dbDrivers: DbSessionDriver[];
}

/**
 * Construct the active session driver set based on which sources are available.
 *
 * Same pattern as token drivers: directory presence → file driver, DB opts → DB driver.
 */
export function createSessionDrivers(opts: SessionDriverRegistryOpts): SessionDriverSet {
  const fileDrivers: FileSessionDriver<SessionFileCursor | unknown>[] = [];
  const dbDrivers: DbSessionDriver[] = [];

  if (opts.claudeDir) {
    fileDrivers.push(claudeSessionDriver);
  }
  if (opts.codexSessionsDir) {
    fileDrivers.push(codexSessionDriver);
  }
  if (opts.geminiDir) {
    fileDrivers.push(geminiSessionDriver);
  }
  if (opts.openCodeMessageDir) {
    fileDrivers.push(openCodeJsonSessionDriver);
  }
  if (opts.openclawDir) {
    fileDrivers.push(openClawSessionDriver);
  }
  if (opts.openCodeDbPath && opts.openSessionDb) {
    dbDrivers.push(
      createOpenCodeSqliteSessionDriver({
        dbPath: opts.openCodeDbPath,
        openSessionDb: opts.openSessionDb,
      }),
    );
  }

  return { fileDrivers, dbDrivers };
}
