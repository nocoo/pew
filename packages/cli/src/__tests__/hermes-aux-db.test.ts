import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openHermesDb } from "../parsers/hermes-sqlite-db.js";

const sessionSchema = `CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, started_at REAL,
  input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  reasoning_tokens INTEGER, source TEXT);
  INSERT INTO sessions VALUES ('synthetic-session','main-model',1788652800,1000,100,0,0,0,'acp');`;

describe("Hermes auxiliary SQLite projection", () => {
  let dir: string;
  let path: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "pew-hermes-aux-db-")); path = join(dir, "state.db"); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reads only auxiliary accounting columns and hashes private billing routes without changing the DB", async () => {
    const db = new DatabaseSync(path);
    db.exec(sessionSchema);
    db.exec(`CREATE TABLE session_model_usage (session_id TEXT,model TEXT,billing_provider TEXT,billing_base_url TEXT,billing_mode TEXT,
      task TEXT,input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,
      reasoning_tokens INTEGER,api_call_count INTEGER,first_seen REAL,last_seen REAL,prompt TEXT);
      INSERT INTO session_model_usage VALUES ('synthetic-session','main-model','openai','','','',1000,100,0,0,0,5,1788652800,1788710580,'PRIVATE_FIXTURE_BODY');
      INSERT INTO session_model_usage VALUES ('synthetic-session','review-model','openai','https://u:PRIVATE_FIXTURE_BODY@synthetic.invalid','subscription',
        'background_review',300,30,0,0,0,2,1788710580,1788710580,'PRIVATE_FIXTURE_BODY');`);
    db.close();
    const before = await readFile(path);
    const handle = openHermesDb(path);
    expect(handle).not.toBeNull();
    try {
      const rows = handle?.queryAuxiliaryUsage?.();
      expect(rows).toHaveLength(1);
      expect(rows?.[0]).toMatchObject({ task: "background_review", input_tokens: 300, api_call_count: 2, source: "acp" });
      expect(rows?.[0].route_key).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(rows)).not.toContain("PRIVATE_FIXTURE_BODY");
      expect(JSON.stringify(rows)).not.toContain("billing_base_url");
      expect(handle?.querySessions()).toMatchObject([{ input_tokens: 1000, output_tokens: 100 }]);
    } finally { handle?.close(); }
    expect(await readFile(path)).toEqual(before);
  });

  it("keeps old schemas readable and does not create an auxiliary table", () => {
    const db = new DatabaseSync(path);
    db.exec(sessionSchema);
    db.close();
    const handle = openHermesDb(path);
    try {
      expect(handle?.querySessions()).toHaveLength(1);
      expect(handle?.queryAuxiliaryUsage).toBeUndefined();
    } finally { handle?.close(); }
    const check = new DatabaseSync(path, { readOnly: true });
    expect(check.prepare("SELECT name FROM sqlite_schema WHERE name='session_model_usage'").all()).toEqual([]);
    check.close();
  });

  it("labels missing optional timestamps as unknown rather than synthesizing a collection time", () => {
    const db = new DatabaseSync(path);
    db.exec(sessionSchema);
    db.exec(`CREATE TABLE session_model_usage (session_id TEXT,model TEXT,task TEXT,input_tokens INTEGER,output_tokens INTEGER);
      INSERT INTO session_model_usage VALUES ('synthetic-session','review-model','background_review',30,3);`);
    db.close();
    const handle = openHermesDb(path);
    try {
      expect(handle?.queryAuxiliaryUsage?.()).toMatchObject([{ first_seen: null, last_seen: null, api_call_count: null, input_tokens: 30, output_tokens: 3 }]);
    } finally { handle?.close(); }
  });
});
