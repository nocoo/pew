/**
 * Adapter round-trip test for openZcodeUsageDb.
 *
 * Creates a real in-process sqlite3 database, seeds a minimal
 * model_usage schema + a couple of rows, then opens the adapter and
 * asserts:
 *   1. AS aliases project every camelCase field correctly.
 *   2. Types survive (numbers/strings/nulls).
 *   3. skipIds filter works.
 *   4. Schema-mismatch path returns null instead of throwing.
 *
 * Skipped when neither bun:sqlite nor node:sqlite is available (older
 * Node.js without the built-in module), because the adapter itself is
 * a no-op there.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { openZcodeUsageDb } from "../parsers/zcode-sqlite-db.js";

const esmRequire = createRequire(import.meta.url);

function tryOpenSqlite(): ((path: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
}) | null {
  const isBun = typeof globalThis.Bun !== "undefined";
  if (isBun) {
    try {
      const { Database } = esmRequire("bun:sqlite");
      return (path: string) => new Database(path);
    } catch {
      return null;
    }
  }
  try {
    const { DatabaseSync } = esmRequire("node:sqlite");
    return (path: string) => new DatabaseSync(path);
  } catch {
    return null;
  }
}

const openWrite = tryOpenSqlite();

describe.skipIf(openWrite === null)("openZcodeUsageDb round-trip", () => {
  it("projects camelCase fields for a real sqlite db", async () => {
    if (!openWrite) return; // narrowing for TS; skipIf already gates
    const dir = await mkdtemp(join(tmpdir(), "pew-zcode-adapter-"));
    const dbPath = join(dir, "db.sqlite");

    const writer = openWrite(dbPath);
    writer.exec(`
      CREATE TABLE model_usage (
        id text primary key,
        logical_request_id text not null,
        attempt_index integer not null default 0,
        session_id text not null,
        turn_id text,
        trace_id text,
        span_id text,
        assistant_message_id text,
        parent_user_message_id text,
        query_source text not null,
        provider_id text not null,
        model_id text not null,
        variant text,
        agent text,
        mode text,
        task_type text,
        status text not null,
        started_at integer not null,
        first_token_at integer,
        completed_at integer,
        duration_ms integer,
        time_to_first_token_ms integer,
        finish_reason text,
        tool_call_count integer not null default 0,
        input_tokens integer not null default 0,
        output_tokens integer not null default 0,
        reasoning_tokens integer not null default 0,
        cache_creation_input_tokens integer not null default 0,
        cache_read_input_tokens integer not null default 0,
        provider_total_tokens integer,
        computed_total_tokens integer not null default 0,
        retry_count integer not null default 0,
        retryable integer not null default 0,
        cancelled_by_user integer not null default 0,
        context_exceeded integer not null default 0,
        error_type text,
        error_code text,
        error_message text,
        raw_usage_json text,
        provider_metadata_json text
      )
    `);
    writer
      .prepare(
        `INSERT INTO model_usage (
          id, logical_request_id, session_id, query_source, provider_id, model_id,
          status, started_at, completed_at,
          input_tokens, output_tokens, reasoning_tokens,
          cache_creation_input_tokens, cache_read_input_tokens,
          provider_total_tokens, computed_total_tokens
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "u1",
        "msg_1",
        "sess_a",
        "main_turn",
        "builtin:bigmodel-coding-plan",
        "GLM-5.2",
        "completed",
        1000,
        2000,
        11933,
        170,
        0,
        0,
        7360,
        12103,
        12103,
      );
    writer
      .prepare(
        `INSERT INTO model_usage (
          id, logical_request_id, session_id, query_source, provider_id, model_id,
          status, started_at, completed_at,
          input_tokens, output_tokens, reasoning_tokens,
          cache_creation_input_tokens, cache_read_input_tokens,
          provider_total_tokens, computed_total_tokens
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "u2",
        "msg_2",
        "sess_a",
        "main_turn",
        "builtin:bigmodel-coding-plan",
        "GLM-5.2",
        "running", // filtered out by SQL
        3000,
        null,
        50,
        0,
        0,
        0,
        0,
        null,
        0,
      );
    writer.close();

    const handle = openZcodeUsageDb(dbPath);
    expect(handle).not.toBeNull();
    const rows = handle!.queryUsageRows(null, []);
    handle!.close();

    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({
      id: "u1",
      sessionId: "sess_a",
      modelId: "GLM-5.2",
      providerId: "builtin:bigmodel-coding-plan",
      status: "completed",
      startedAt: 1000,
      completedAt: 2000,
      inputTokens: 11933,
      outputTokens: 170,
      reasoningTokens: 0,
      cacheReadInputTokens: 7360,
      cacheCreationInputTokens: 0,
      providerTotalTokens: 12103,
      computedTotalTokens: 12103,
    });
    // Types survive round-trip.
    expect(typeof r.inputTokens).toBe("number");
    expect(typeof r.id).toBe("string");

    await rm(dir, { recursive: true, force: true });
  });

  it("returns null on missing model_usage table (schema mismatch)", async () => {
    if (!openWrite) return;
    const dir = await mkdtemp(join(tmpdir(), "pew-zcode-adapter-"));
    const dbPath = join(dir, "db.sqlite");

    const writer = openWrite(dbPath);
    writer.exec(`CREATE TABLE other_table (id text)`);
    writer.close();

    const handle = openZcodeUsageDb(dbPath);
    expect(handle).toBeNull();

    await rm(dir, { recursive: true, force: true });
  });

  it("skipIds filters same-completed_at boundary rows", async () => {
    if (!openWrite) return;
    const dir = await mkdtemp(join(tmpdir(), "pew-zcode-adapter-"));
    const dbPath = join(dir, "db.sqlite");
    const writer = openWrite(dbPath);
    writer.exec(`
      CREATE TABLE model_usage (
        id text primary key,
        logical_request_id text not null,
        attempt_index integer not null default 0,
        session_id text not null,
        turn_id text,
        trace_id text,
        span_id text,
        assistant_message_id text,
        parent_user_message_id text,
        query_source text not null,
        provider_id text not null,
        model_id text not null,
        variant text,
        agent text,
        mode text,
        task_type text,
        status text not null,
        started_at integer not null,
        first_token_at integer,
        completed_at integer,
        duration_ms integer,
        time_to_first_token_ms integer,
        finish_reason text,
        tool_call_count integer not null default 0,
        input_tokens integer not null default 0,
        output_tokens integer not null default 0,
        reasoning_tokens integer not null default 0,
        cache_creation_input_tokens integer not null default 0,
        cache_read_input_tokens integer not null default 0,
        provider_total_tokens integer,
        computed_total_tokens integer not null default 0,
        retry_count integer not null default 0,
        retryable integer not null default 0,
        cancelled_by_user integer not null default 0,
        context_exceeded integer not null default 0,
        error_type text,
        error_code text,
        error_message text,
        raw_usage_json text,
        provider_metadata_json text
      )
    `);
    const insert = writer.prepare(
      `INSERT INTO model_usage (
        id, logical_request_id, session_id, query_source, provider_id, model_id,
        status, started_at, completed_at,
        input_tokens, output_tokens, reasoning_tokens,
        cache_creation_input_tokens, cache_read_input_tokens,
        provider_total_tokens, computed_total_tokens
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const id of ["a", "b", "c"]) {
      insert.run(
        id,
        `msg_${id}`,
        "sess_x",
        "main_turn",
        "prov",
        "GLM-5.2",
        "completed",
        1000,
        2000,
        100,
        20,
        0,
        0,
        0,
        120,
        120,
      );
    }
    writer.close();

    const handle = openZcodeUsageDb(dbPath);
    expect(handle).not.toBeNull();
    const rows = handle!.queryUsageRows(1500, ["a", "b"]);
    handle!.close();
    expect(rows.map((r) => r.id)).toEqual(["c"]);
  });
});
