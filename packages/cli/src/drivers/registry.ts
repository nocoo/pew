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
  FileTokenDriver,
  DbTokenDriver,
  FileSessionDriver,
  DbSessionDriver,
} from "./types.js";

// -- Token driver singletons --
import { claudeTokenDriver } from "./token/claude-token-driver.js";

import { openCodeJsonTokenDriver } from "./token/opencode-json-token-driver.js";
import { openClawTokenDriver } from "./token/openclaw-token-driver.js";
import { codexTokenDriver } from "./token/codex-token-driver.js";

import { copilotCliTokenDriver } from "./token/copilot-cli-token-driver.js";
import { piTokenDriver } from "./token/pi-token-driver.js";

import { grokTokenDriver } from "./token/grok-token-driver.js";
import { workbuddyTokenDriver } from "./token/workbuddy-token-driver.js";
import {
  createOpenCodeSqliteTokenDriver,
  type OpenCodeSqliteTokenDriverOpts,
} from "./token/opencode-sqlite-token-driver.js";
import {
  createHermesSqliteTokenDriver,
  type HermesSqliteTokenDriverOpts,
} from "./token/hermes-token-driver.js";

// -- Session driver singletons --
import { claudeSessionDriver } from "./session/claude-session-driver.js";
import { codexSessionDriver } from "./session/codex-session-driver.js";
import { copilotCliSessionDriver } from "./session/copilot-cli-session-driver.js";

import { openCodeJsonSessionDriver } from "./session/opencode-json-session-driver.js";
import { openClawSessionDriver } from "./session/openclaw-session-driver.js";
import { piSessionDriver } from "./session/pi-session-driver.js";

import { grokSessionDriver } from "./session/grok-session-driver.js";
import { workbuddySessionDriver } from "./session/workbuddy-session-driver.js";
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

  openCodeMessageDir?: string;
  openclawDir?: string;
  codexSessionsDir?: string;
  piSessionsDir?: string;

  copilotCliLogsDir?: string;
  copilotCliOtelPaths?: string[];
  /** Grok CLI unified log path (~/.grok/logs/unified.jsonl) */
  grokLogsPath?: string;
  /** WorkBuddy data roots (domestic + international) */
  workbuddyDirs?: string[];
  openCodeDbPath?: string;
  openMessageDb?: OpenCodeSqliteTokenDriverOpts["openMessageDb"];
  /** Default Hermes DB path (~/.hermes/state.db) */
  hermesDbPath?: string;
  /** Additional Hermes profile DBs (e.g. ~/.hermes/profiles/<name>/state.db) */
  hermesProfileDbPaths?: Array<{ dbPath: string; dbKey: string }>;
  openHermesDb?: HermesSqliteTokenDriverOpts["openHermesDb"];
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
 * Drivers are registered in alphabetical order by source.
 */
export function createTokenDrivers(opts: TokenDriverRegistryOpts): TokenDriverSet {
  const fileDrivers: FileTokenDriver<FileCursorBase>[] = [];
  const dbDrivers: DbTokenDriver[] = [];

  // File drivers (alphabetical by source)
  if (opts.claudeDir) {
    fileDrivers.push(claudeTokenDriver);
  }
  if (opts.codexSessionsDir) {
    fileDrivers.push(codexTokenDriver);
  }
  if (opts.copilotCliLogsDir || (opts.copilotCliOtelPaths?.length ?? 0) > 0) {
    fileDrivers.push(copilotCliTokenDriver);
  }

  if (opts.grokLogsPath) {
    fileDrivers.push(grokTokenDriver);
  }

  if (opts.openCodeMessageDir) {
    fileDrivers.push(openCodeJsonTokenDriver);
  }
  if (opts.openclawDir) {
    fileDrivers.push(openClawTokenDriver);
  }
  if (opts.piSessionsDir) {
    fileDrivers.push(piTokenDriver);
  }
  if (opts.workbuddyDirs && opts.workbuddyDirs.length > 0) {
    fileDrivers.push(workbuddyTokenDriver);
  }

  // DB drivers (alphabetical by source)
  // Hermes: create driver for default DB + all profile DBs
  if (opts.openHermesDb) {
    // Default DB at ~/.hermes/state.db (or $HERMES_HOME/state.db)
    if (opts.hermesDbPath) {
      dbDrivers.push(
        createHermesSqliteTokenDriver({
          dbPath: opts.hermesDbPath,
          dbKey: "default",
          openHermesDb: opts.openHermesDb,
        }),
      );
    }
    // Profile DBs at ~/.hermes/profiles/<name>/state.db
    if (opts.hermesProfileDbPaths) {
      for (const { dbPath, dbKey } of opts.hermesProfileDbPaths) {
        dbDrivers.push(
          createHermesSqliteTokenDriver({
            dbPath,
            dbKey,
            openHermesDb: opts.openHermesDb,
          }),
        );
      }
    }
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

  openCodeMessageDir?: string;
  openclawDir?: string;
  codexSessionsDir?: string;
  copilotCliLogsDir?: string;
  piSessionsDir?: string;
  /** Grok CLI sessions root (~/.grok/sessions) */
  grokSessionsDir?: string;
  /** WorkBuddy data roots (domestic + international) */
  workbuddyDirs?: string[];
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
  if (opts.copilotCliLogsDir) {
    fileDrivers.push(copilotCliSessionDriver);
  }

  if (opts.grokSessionsDir) {
    fileDrivers.push(grokSessionDriver);
  }

  if (opts.openCodeMessageDir) {
    fileDrivers.push(openCodeJsonSessionDriver);
  }
  if (opts.openclawDir) {
    fileDrivers.push(openClawSessionDriver);
  }
  if (opts.piSessionsDir) {
    fileDrivers.push(piSessionDriver);
  }
  if (opts.workbuddyDirs && opts.workbuddyDirs.length > 0) {
    fileDrivers.push(workbuddySessionDriver);
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
