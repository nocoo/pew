import { randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import type { PlatformProxy } from "../packages/worker/node_modules/wrangler";
import type { D1Database, KVNamespace } from "../packages/worker/node_modules/@cloudflare/workers-types";
import { localD1BaseUrl } from "../packages/web/src/lib/d1";

type Bindings = { DB: D1Database; CACHE: KVNamespace };
type LocalWorker = { default: { fetch(request: Request, env: Bindings & { WORKER_SECRET?: string; WORKER_READ_SECRET?: string }): Promise<Response> } };

/**
 * Split a migration file into statements the way wrangler's local
 * `d1 execute` does. Migrations carry triggers, whose bodies contain `;`, so
 * a quote-aware split is not enough: the statement ends only after the `END`
 * that closes the body. Ported from wrangler's `src/d1/splitter.ts` state
 * machine; the cursor moves by token, so a `;` inside `--` quotes or a
 * quoted identifier never splits.
 */
export function splitStatements(sql: string): string[] {
  // D1 runs each batch in its own transaction, so an exported dump's explicit
  // BEGIN TRANSACTION;/COMMIT; pair must be dropped (wrangler does the same).
  const source = sql.includes("BEGIN TRANSACTION") ? sql.replace("BEGIN TRANSACTION;", "").replace("COMMIT;", "") : sql;
  const text = source.replace(/\r\n/g, "\n");
  type State = "INVALID" | "START" | "NORMAL" | "EXPLAIN" | "CREATE" | "TRIGGER" | "SEMI" | "END";
  type Token = "SEMI" | "WS" | "OTHER" | "EXPLAIN" | "CREATE" | "TEMP" | "TRIGGER" | "END";
  const transitions: Record<State, Record<Token, State>> = {
    INVALID: { SEMI: "START", WS: "INVALID", OTHER: "NORMAL", EXPLAIN: "EXPLAIN", CREATE: "CREATE", TEMP: "NORMAL", TRIGGER: "NORMAL", END: "NORMAL" },
    START: { SEMI: "START", WS: "START", OTHER: "NORMAL", EXPLAIN: "EXPLAIN", CREATE: "CREATE", TEMP: "NORMAL", TRIGGER: "NORMAL", END: "NORMAL" },
    NORMAL: { SEMI: "START", WS: "NORMAL", OTHER: "NORMAL", EXPLAIN: "NORMAL", CREATE: "NORMAL", TEMP: "NORMAL", TRIGGER: "NORMAL", END: "NORMAL" },
    EXPLAIN: { SEMI: "START", WS: "EXPLAIN", OTHER: "EXPLAIN", EXPLAIN: "NORMAL", CREATE: "CREATE", TEMP: "NORMAL", TRIGGER: "NORMAL", END: "NORMAL" },
    CREATE: { SEMI: "START", WS: "CREATE", OTHER: "NORMAL", EXPLAIN: "NORMAL", CREATE: "NORMAL", TEMP: "CREATE", TRIGGER: "TRIGGER", END: "NORMAL" },
    TRIGGER: { SEMI: "SEMI", WS: "TRIGGER", OTHER: "TRIGGER", EXPLAIN: "TRIGGER", CREATE: "TRIGGER", TEMP: "TRIGGER", TRIGGER: "TRIGGER", END: "TRIGGER" },
    SEMI: { SEMI: "SEMI", WS: "SEMI", OTHER: "TRIGGER", EXPLAIN: "TRIGGER", CREATE: "TRIGGER", TEMP: "TRIGGER", TRIGGER: "TRIGGER", END: "END" },
    END: { SEMI: "START", WS: "END", OTHER: "TRIGGER", EXPLAIN: "TRIGGER", CREATE: "TRIGGER", TEMP: "TRIGGER", TRIGGER: "TRIGGER", END: "TRIGGER" },
  };
  const tokenOfWord = (word: string): Token => {
    switch (word.toLowerCase()) {
      case "explain": return "EXPLAIN";
      case "create": return "CREATE";
      case "temp":
      case "temporary": return "TEMP";
      case "trigger": return "TRIGGER";
      case "end": return "END";
      default: return "OTHER";
    }
  };
  const isWordChar = (char: string) => /[A-Za-z0-9_$]/.test(char) || char.charCodeAt(0) > 0x7f;
  // Offset just past the `;` that ends the statement starting at `from`, such
  // that `text.slice(from, end - 1)` is the statement body.
  const statementEnd = (from: number): number | undefined => {
    let state: State = "INVALID";
    let index = from;
    while (index < text.length) {
      const char = text[index] as string;
      let token: Token;
      if (char === ";") {
        token = "SEMI";
        index++;
      } else if (/\s/.test(char)) {
        token = "WS";
        index++;
      } else if ((char === "/" && text[index + 1] === "*") || (char === "-" && text[index + 1] === "-")) {
        const close = char === "/" ? text.indexOf("*/", index + 2) : text.indexOf("\n", index + 2);
        if (close === -1) return undefined;
        index = char === "/" ? close + 2 : close + 1;
        token = "WS";
      } else if (char === "'" || char === '"' || char === "`" || char === "[") {
        const close = text.indexOf(char === "[" ? "]" : char, index + 1);
        if (close === -1) return undefined;
        index = close + 1;
        token = "OTHER";
      } else if (isWordChar(char)) {
        const wordStart = index;
        while (index < text.length && isWordChar(text[index] as string)) index++;
        token = tokenOfWord(text.slice(wordStart, index));
      } else {
        index++;
        token = "OTHER";
      }
      state = transitions[state][token];
      if (state === "START") return index;
    }
    return undefined;
  };
  // A comment-only span is not a query: D1 rejects empty prepares, and
  // wrangler's splitter treats comments as whitespace.
  const isQuery = (statement: string) => statement.replace(/--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g, "").trim().length > 0;
  const statements: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = statementEnd(start);
    const statement = text.slice(start, end === undefined ? text.length : end - 1).trim();
    if (isQuery(statement)) statements.push(statement);
    if (end === undefined) break;
    start = end;
  }
  return statements;
}

/**
 * Apply the migrations in one Miniflare instance, reproducing what
 * `wrangler d1 migrations apply --local` does: create the tracking table, run
 * each file's statements in a batch together with its bookkeeping insert.
 *
 * The CLI is not used because it starts a fresh Miniflare (and workerd child)
 * per migration file; on a loaded host that measured 30-50s for this
 * repository's set against about 1s for a single instance. This is test-only
 * plumbing over the same D1 binding type the suite runs against.
 *
 * `databaseId` must equal the id `getPlatformProxy` later resolves from the
 * config: Miniflare names the persistence file after it, so a mismatched id
 * writes a second, empty database that the binding never opens.
 */
async function applyMigrations(directory: string, persistTo: string, databaseId: string, signal?: AbortSignal): Promise<void> {
  const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`No migrations present at ${directory}`);
  const scripts = files.map((name) => {
    const statements = splitStatements(readFileSync(join(directory, name), "utf8"));
    if (statements.length === 0) throw new Error(`Local D1 migrations failed: ${name}: no statements`);
    return [name, [...statements, `INSERT INTO "d1_migrations" (name) values ('${name.replace(/'/g, "''")}')`]] as const;
  });
  const wranglerEntry = createRequire(resolve("packages/worker/package.json")).resolve("wrangler");
  const { Miniflare, convertV4MiniflareOptions } = await import(createRequire(wranglerEntry).resolve("miniflare") as string);
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "", resourcePersistencePath: join(persistTo, "v3"), d1Databases: { DATABASE: databaseId } }));
  // An interrupt must stop the work in progress, not just the next file: the
  // caller's cleanup only runs once this returns, and each batch or instance
  // start can take seconds on a loaded host.
  let rejectOnAbort: (reason: unknown) => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => { rejectOnAbort = reject; });
  const onAbort = () => rejectOnAbort(signal?.reason ?? new Error("Interrupted"));
  signal?.addEventListener("abort", onAbort, { once: true });
  const abortable = <T>(work: Promise<T>): Promise<T> => Promise.race([work, interrupted]);
  try {
    if (signal?.aborted) throw signal.reason;
    const db = await abortable(mf.getD1Database("DATABASE")) as unknown as D1Database;
    await abortable(db.prepare('CREATE TABLE IF NOT EXISTS "d1_migrations"(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)').run());
    const applied = await db.prepare('SELECT name FROM "d1_migrations"').all<{ name: string }>();
    const done = new Set(applied.results.map(({ name }) => name));
    for (const [name, queries] of scripts) {
      if (done.has(name)) continue;
      if (signal?.aborted) throw signal.reason;
      try {
        await abortable(db.batch(queries.map((query) => db.prepare(query))));
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw new Error(`Local D1 migrations failed: ${name}: ${(error as { cause?: Error }).cause?.message ?? (error as Error).message}`);
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await mf.dispose();
  }
}

export async function verifyLocalMarker(env: Record<string, string>): Promise<void> {
  // Check the run marker before deriving the URL: localD1BaseUrl requires it
  // too, and its generic "isolated loopback" error would mask the more precise
  // "configuration missing" this function exists to report.
  if (!env.PEW_TEST_RUN_ID) throw new Error("Local D1 test marker configuration missing");
  const base = localD1BaseUrl({
    accountId: env.CF_ACCOUNT_ID ?? "",
    databaseId: env.CF_D1_DATABASE_ID ?? "",
    apiToken: env.CF_D1_API_TOKEN ?? "",
  }, env);
  if (!base) throw new Error("Local D1 test marker configuration missing");
  for (const key of ["WORKER_INGEST_URL", "WORKER_READ_URL"]) {
    const url = new URL(env[key] ?? "");
    if (url.origin !== base) throw new Error("Local Worker must belong to the same isolated test target");
  }
  const response = await fetch(`${base}/query`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${env.CF_D1_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql: "SELECT key,value FROM _test_marker ORDER BY key" }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await response.json() as { success?: boolean; result?: Array<{ results?: Array<{ key: string; value: string }> }> };
  const rows = data.result?.[0]?.results;
  if (!response.ok || !data.success || rows?.length !== 2 ||
    rows[0]?.key !== "env" || rows[0]?.value !== "test" ||
    rows[1]?.key !== "run" || rows[1]?.value !== env.PEW_TEST_RUN_ID) {
    throw new Error("Local D1 _test_marker is missing, non-test, or belongs to another run");
  }
}

export async function localIsolatedEnv(migrations = resolve("scripts/migrations"), signal?: AbortSignal, readiness = false) {
  const state = mkdtempSync(join(tmpdir(), "pew-e2e-"));
  process.env.HOME = state;
  process.env.XDG_CONFIG_HOME = state;
  process.env.WRANGLER_SEND_METRICS = "false";
  const runId = randomUUID();
  const token = randomBytes(24).toString("hex");
  const secret = randomBytes(24).toString("hex");
  const readSecret = randomBytes(24).toString("hex");
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: state,
    TMPDIR: state,
    XDG_CONFIG_HOME: state,
    NODE_ENV: "development",
    RESOURCE_ENV: "test",
    E2E_SKIP_AUTH: "true",
    AUTH_SECRET: randomBytes(24).toString("hex"),
    CF_ACCOUNT_ID: "pew-local-test",
    CF_D1_DATABASE_ID: "pew-local-test",
    CF_D1_API_TOKEN: token,
    WORKER_SECRET: secret,
    WORKER_READ_SECRET: readSecret,
    PEW_TEST_RUN_ID: runId,
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_HIDE_BANNER: "true",
    CI: process.env.CI ?? "",
  };
  let proxy: PlatformProxy<Bindings> | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let marked = false;
  let disposal: Promise<void> | undefined;
  const dispose = () => disposal ??= (async () => {
    const errors: unknown[] = [];
    try {
      if (marked && proxy) {
        const rows = await proxy.env.DB.prepare("SELECT key,value FROM _test_marker ORDER BY key").all<{ key: string; value: string }>();
        if (rows.results.length !== 2 || rows.results[0]?.key !== "env" || rows.results[0]?.value !== "test" || rows.results[1]?.key !== "run" || rows.results[1]?.value !== runId) {
          throw new Error("Refusing to remove D1 state with a mismatched ownership marker");
        }
      }
    } catch (error) { errors.push(error); }
    server?.stop(true);
    try { await proxy?.dispose(); } catch (error) { errors.push(error); }
    if (!errors.length) rmSync(state, { recursive: true });
    if (errors.length) throw new AggregateError(errors, "Local D1 cleanup failed");
  })();
  try {
    signal?.throwIfAborted();
    const migrationDir = join(state, "migrations");
    mkdirSync(migrationDir);
    const superseded = new Set(["004-is-public.sql", "006-device-id.sql", "006c-team-logo-url.sql"]);
    for (const [index, name] of readdirSync(migrations).filter((name) => name.endsWith(".sql") && !superseded.has(name)).sort().entries()) {
      copyFileSync(join(migrations, name), join(migrationDir, `${String(index).padStart(4, "0")}-${name}`));
    }
    const configPath = join(state, "wrangler.json");
    const databaseId = runId;
    writeFileSync(configPath, JSON.stringify({
      name: "pew-local-test", compatibility_date: "2026-03-01", workers_dev: false, routes: [],
      d1_databases: [{ binding: "DB", database_name: "pew-local-test", database_id: databaseId, migrations_dir: migrationDir }],
      kv_namespaces: [{ binding: "CACHE", id: runId.replaceAll("-", "") }],
    }));
    await applyMigrations(migrationDir, state, databaseId, signal);
    const { getPlatformProxy } = await import("../packages/worker/node_modules/wrangler");
    proxy = await getPlatformProxy<Bindings>({ configPath, envFiles: [], persist: { path: join(state, "v3") }, remoteBindings: false });
    const bindings = proxy.env;
    await bindings.DB.prepare("CREATE TABLE _test_marker(key TEXT PRIMARY KEY,value TEXT NOT NULL)").run();
    await bindings.DB.batch([
      bindings.DB.prepare("INSERT INTO _test_marker VALUES ('env','test')"),
      bindings.DB.prepare("INSERT INTO _test_marker VALUES ('run',?)").bind(runId),
    ]);
    marked = true;
    await bindings.DB.prepare("INSERT INTO users(id,email,name) VALUES (?,?,?)").bind(
      `e2e-test-user-${runId}`, `e2e-${runId}@test.invalid`, "E2E Test User",
    ).run();
    if (readiness) {
      const { seedReadiness } = await import("./readiness-seed");
      Object.assign(env, await seedReadiness(bindings.DB, `e2e-test-user-${runId}`));
    }
    const ingestWorker = await import(resolve("packages/worker/src/index.ts")) as LocalWorker;
    const readWorker = await import(resolve("packages/worker-read/src/index.ts")) as LocalWorker;
    server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/query") {
          if (request.method !== "POST" || request.headers.get("Authorization") !== `Bearer ${token}`) {
            return Response.json({ success: false, errors: [{ message: "Unauthorized" }] }, { status: 401 });
          }
          try {
            const body = await request.json() as { sql: string; params?: unknown[]; batch?: Array<{ sql: string; params?: unknown[] }> };
            const statements = (body.batch ?? [body]).map(({ sql, params = [] }) => bindings.DB.prepare(sql).bind(...params));
            const results = await bindings.DB.batch(statements);
            return Response.json({ success: true, result: results });
          } catch (error) {
            return Response.json({ success: false, errors: [{ message: error instanceof Error ? error.message : "Local query failed" }] }, { status: 500 });
          }
        }
        if (url.pathname.startsWith("/ingest")) return ingestWorker.default.fetch(request, { ...bindings, WORKER_SECRET: secret });
        return readWorker.default.fetch(request, { ...bindings, WORKER_READ_SECRET: readSecret });
      },
    });
    const base = `http://127.0.0.1:${server.port}`;
    Object.assign(env, { PEW_LOCAL_D1_URL: base, WORKER_INGEST_URL: `${base}/ingest`, WORKER_READ_URL: base });
    await verifyLocalMarker(env);
    signal?.throwIfAborted();
    return { env, state, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
