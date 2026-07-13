/**
 * Adapter round-trip test for openZcodeSessionDb.
 *
 * Creates a real in-process sqlite3 database, seeds session + message +
 * model_usage rows, then opens the adapter and asserts:
 *   1. querySessions returns AS-aliased camelCase rows (timeCreated,
 *      timeUpdated, taskType).
 *   2. queryMessages counts user/assistant/total via json_extract on
 *      data.role, returning three integers.
 *   3. queryPrimaryModel picks the most-frequent modelId with stable
 *      lexicographic tie-break.
 *   4. skipIds filters same-ms boundary rows.
 *   5. Schema-mismatch returns null.
 *
 * Skipped when neither bun:sqlite nor node:sqlite is available.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { openZcodeSessionDb } from "../parsers/zcode-sqlite-session-db.js";

const esmRequire = createRequire(import.meta.url);

function tryOpenSqlite(): ((path: string) => {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
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

const SESSION_SCHEMA = `
  CREATE TABLE session (
    id text primary key,
    project_id text not null,
    workspace_id text,
    parent_id text,
    slug text not null,
    directory text not null,
    path text,
    title text not null,
    version text not null,
    share_url text,
    summary_additions integer,
    summary_deletions integer,
    summary_files integer,
    summary_diffs text,
    revert text,
    permission text,
    time_created integer not null,
    time_updated integer not null,
    time_compacting integer,
    time_archived integer,
    task_type text not null default 'interactive',
    title_source text not null default 'first_input',
    title_message_id text,
    time_title_updated integer,
    trace_id text
  )
`;

const MESSAGE_SCHEMA = `
  CREATE TABLE message (
    id text primary key,
    session_id text not null,
    time_created integer not null,
    time_updated integer not null,
    data text not null
  )
`;

const MODEL_USAGE_SCHEMA = `
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
`;

describe.skipIf(openWrite === null)("openZcodeSessionDb round-trip", () => {
  it("projects camelCase session fields for a real sqlite db", async () => {
    if (!openWrite) return;
    const dir = await mkdtemp(join(tmpdir(), "pew-zcode-session-adapter-"));
    const dbPath = join(dir, "db.sqlite");

    const writer = openWrite(dbPath);
    writer.exec(SESSION_SCHEMA);
    writer.exec(MESSAGE_SCHEMA);
    writer.exec(MODEL_USAGE_SCHEMA);
    writer
      .prepare(
        `INSERT INTO session (
          id, project_id, slug, directory, title, version,
          time_created, time_updated, task_type
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        "sess_1",
        "proj_a",
        "sess_1",
        "/proj/dir",
        "hello",
        "0.15.2",
        1000,
        2000,
        "interactive",
      );
    writer.close();

    const handle = openZcodeSessionDb(dbPath);
    expect(handle).not.toBeNull();
    const rows = handle!.querySessions(null, []);
    handle!.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "sess_1",
      directory: "/proj/dir",
      title: "hello",
      timeCreated: 1000,
      timeUpdated: 2000,
      taskType: "interactive",
    });
    // types survive
    expect(typeof rows[0].timeCreated).toBe("number");
    expect(typeof rows[0].id).toBe("string");

    await rm(dir, { recursive: true, force: true });
  });

  it("queryMessages counts user/assistant/total via json_extract(data.role)", async () => {
    if (!openWrite) return;
    const dir = await mkdtemp(join(tmpdir(), "pew-zcode-session-adapter-"));
    const dbPath = join(dir, "db.sqlite");
    const writer = openWrite(dbPath);
    writer.exec(SESSION_SCHEMA);
    writer.exec(MESSAGE_SCHEMA);
    writer.exec(MODEL_USAGE_SCHEMA);
    writer
      .prepare(
        `INSERT INTO session (
          id, project_id, slug, directory, title, version,
          time_created, time_updated, task_type
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run("s1", "p", "s1", "/d", "t", "0.15.2", 1, 2, "interactive");

    const insertMsg = writer.prepare(
      `INSERT INTO message (id, session_id, time_created, time_updated, data)
       VALUES (?,?,?,?,?)`,
    );
    insertMsg.run("m1", "s1", 1, 1, JSON.stringify({ role: "user" }));
    insertMsg.run("m2", "s1", 2, 2, JSON.stringify({ role: "assistant" }));
    insertMsg.run("m3", "s1", 3, 3, JSON.stringify({ role: "assistant" }));
    insertMsg.run("m4", "s1", 4, 4, JSON.stringify({ role: "assistant" }));
    insertMsg.run("m5", "s1", 5, 5, JSON.stringify({ role: "tool" }));
    writer.close();

    const handle = openZcodeSessionDb(dbPath);
    const counts = handle!.queryMessages("s1");
    handle!.close();
    expect(counts).toEqual({ user: 1, assistant: 3, total: 5 });

    await rm(dir, { recursive: true, force: true });
  });

  it("queryPrimaryModel picks most-frequent modelId with lexicographic tie-break", async () => {
    if (!openWrite) return;
    const dir = await mkdtemp(join(tmpdir(), "pew-zcode-session-adapter-"));
    const dbPath = join(dir, "db.sqlite");
    const writer = openWrite(dbPath);
    writer.exec(SESSION_SCHEMA);
    writer.exec(MESSAGE_SCHEMA);
    writer.exec(MODEL_USAGE_SCHEMA);
    const ins = writer.prepare(
      `INSERT INTO model_usage (
        id, logical_request_id, session_id, query_source, provider_id, model_id,
        status, started_at, completed_at,
        input_tokens, output_tokens, reasoning_tokens,
        cache_creation_input_tokens, cache_read_input_tokens,
        provider_total_tokens, computed_total_tokens
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    // Session s1: GLM-5.2 wins 3-2 over GLM-4.5.
    for (const [id, model] of [
      ["u1", "GLM-5.2"], ["u2", "GLM-5.2"], ["u3", "GLM-5.2"],
      ["u4", "GLM-4.5"], ["u5", "GLM-4.5"],
    ]) {
      ins.run(
        id, `req_${id}`, "s1", "main_turn", "prov", model,
        "completed", 1000, 2000, 100, 20, 0, 0, 0, 120, 120,
      );
    }
    // Session s2: tie (GLM-4.5 vs GLM-5.2 both 2); tie-break by lex → "GLM-4.5".
    for (const [id, model] of [
      ["v1", "GLM-4.5"], ["v2", "GLM-4.5"],
      ["v3", "GLM-5.2"], ["v4", "GLM-5.2"],
    ]) {
      ins.run(
        id, `req_${id}`, "s2", "main_turn", "prov", model,
        "completed", 1000, 2000, 100, 20, 0, 0, 0, 120, 120,
      );
    }
    // Session s3: no rows → null.
    writer.close();

    const handle = openZcodeSessionDb(dbPath);
    expect(handle!.queryPrimaryModel("s1")).toBe("GLM-5.2");
    expect(handle!.queryPrimaryModel("s2")).toBe("GLM-4.5");
    expect(handle!.queryPrimaryModel("s3")).toBeNull();
    handle!.close();

    await rm(dir, { recursive: true, force: true });
  });

  it("skipIds filters same-time_updated boundary rows", async () => {
    if (!openWrite) return;
    const dir = await mkdtemp(join(tmpdir(), "pew-zcode-session-adapter-"));
    const dbPath = join(dir, "db.sqlite");
    const writer = openWrite(dbPath);
    writer.exec(SESSION_SCHEMA);
    writer.exec(MESSAGE_SCHEMA);
    writer.exec(MODEL_USAGE_SCHEMA);
    const ins = writer.prepare(
      `INSERT INTO session (
        id, project_id, slug, directory, title, version,
        time_created, time_updated, task_type
      ) VALUES (?,?,?,?,?,?,?,?,?)`,
    );
    for (const id of ["a", "b", "c"]) {
      ins.run(id, "p", id, "/d", "t", "0.15.2", 1000, 2000, "interactive");
    }
    writer.close();

    const handle = openZcodeSessionDb(dbPath);
    const rows = handle!.querySessions(1500, ["a", "b"]);
    handle!.close();
    expect(rows.map((r) => r.id)).toEqual(["c"]);
  });

  it("returns null when session table is missing (schema mismatch)", async () => {
    if (!openWrite) return;
    const dir = await mkdtemp(join(tmpdir(), "pew-zcode-session-adapter-"));
    const dbPath = join(dir, "db.sqlite");
    const writer = openWrite(dbPath);
    writer.exec(`CREATE TABLE other (id text)`);
    writer.close();

    const handle = openZcodeSessionDb(dbPath);
    expect(handle).toBeNull();

    await rm(dir, { recursive: true, force: true });
  });
});
