#!/usr/bin/env bun
/** Pew's readonly audit: source AST + disposable in-memory accounting probes. */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, type Stats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "oxc-parser";
import { validateEvidenceRecord } from "../packages/core/src/evidence-validation";
import { usageLabel } from "../packages/cli/src/utils/usage-evidence";

const STAGES = ["parser", "cursor", "spool", "upload", "worker", "api", "ui"] as const;
type Stage = typeof STAGES[number];
type Node = { type?: string; start?: number; [key: string]: unknown };
export interface AuditDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown };
}
const skip = new Set(["node_modules", "dist", "build", "coverage", "cache", "logs", "sessions", "spool", "test-results", "playwright-report"]);
const required: Record<Stage, string[]> = {
  parser: ["packages/cli/src/parsers/pi.ts", "packages/cli/src/parsers/hermes-review.ts", "packages/cli/src/parsers/hermes-usage-evidence.ts", "packages/cli/src/parsers/hermes-sqlite-db.ts"],
  cursor: ["packages/cli/src/commands/sync.ts", "packages/cli/src/commands/reset.ts"],
  spool: ["packages/cli/src/storage/evidence-queue.ts", "packages/cli/src/storage/base-queue.ts", "packages/cli/src/utils/usage-evidence.ts"],
  upload: ["packages/cli/src/commands/upload.ts", "packages/cli/src/commands/upload-engine.ts", "packages/web/src/app/api/ingest/evidence/route.ts"],
  worker: ["packages/worker/src/index.ts", "packages/worker/src/evidence-sql.ts", "packages/core/src/evidence-validation.ts", "scripts/migrations/022-usage-evidence.sql"],
  api: ["packages/worker-read/src/rpc/usage.ts", "packages/web/src/app/api/usage/route.ts"],
  ui: ["packages/web/src/components/dashboard/usage-timing-notice.tsx", "packages/web/src/app/(dashboard)/dashboard/page.tsx",
    "packages/web/src/app/(dashboard)/daily-usage/page.tsx", "packages/web/src/app/(dashboard)/hourly-usage/page.tsx", "packages/web/src/components/profile/profile-content.tsx"],
};
const suites = [
  "packages/cli/src/__tests__/pi-compaction.test.ts", "packages/cli/src/__tests__/hermes-background-usage.test.ts",
  "packages/cli/src/__tests__/hermes-auxiliary-usage.test.ts", "packages/cli/src/__tests__/hermes-aux-db.test.ts",
  "packages/cli/src/__tests__/evidence-queue.test.ts", "packages/cli/src/__tests__/evidence-sync.test.ts",
  "packages/core/src/__tests__/evidence-validation.test.ts", "scripts/__tests__/usage-evidence-pipeline.test.ts",
  "packages/web/src/__tests__/evidence-ingest.test.ts",
  "packages/web/src/components/dashboard/usage-timing-notice.test.tsx", "scripts/__tests__/ponytail-audit.test.ts",
];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Fixed repo roots and extensions. No git/config/queue/log reads or symlinks. */
export function readAuditInputs(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const noLinks = (path: string) => {
    let current = root;
    for (const part of path.split("/")) {
      current = join(current, part);
      try { if (lstatSync(current).isSymbolicLink()) return false; } catch { return false; }
    }
    return true;
  };
  function walk(path: string): void {
    if (!noLinks(path)) return;
    const absolute = join(root, path);
    let st: Stats;
    try { st = lstatSync(absolute); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (name.startsWith(".") || skip.has(name)) continue;
        walk(`${path}/${name}`);
      }
    } else if (st.isFile() && /\.(?:tsx?|mts|cts|sql)$/.test(path)) {
      files.set(path, readFileSync(absolute, "utf8"));
    }
  }
  for (const pkg of ["cli", "core", "web", "worker", "worker-read"]) walk(`packages/${pkg}/src`);
  walk("scripts");
  for (const path of ["package.json", "bun.lock", "vitest.config.ts", "CLAUDE.md", "scripts/ponytail-audit.sh",
    ".agents/skills/ponytail-audit/SKILL.md", ".claude/commands/ponytail-audit.md", "docs/47-usage-evidence.md"]) {
    const file = join(root, path);
    try { if (noLinks(path) && lstatSync(file).isFile()) files.set(path, readFileSync(file, "utf8")); } catch { /* missing inputs fail the stage checks */ }
  }
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b, "en")));
}

function visit(value: unknown, fn: (node: Node) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const child of value) visit(child, fn); return; }
  const node = value as Node;
  if (typeof node.type === "string") fn(node);
  for (const [key, child] of Object.entries(node)) if (key !== "loc") visit(child, fn);
}
function member(value: unknown): string {
  const n = value as Node | undefined;
  if (!n) return "";
  if (n.type === "Identifier") return String(n.name);
  if (n.type === "ThisExpression") return "this";
  if (n.type === "MemberExpression") return `${member(n.object)}.${member(n.property)}`;
  return "";
}
function literal(n: Node | undefined): string | null {
  if (n?.type === "Literal" && typeof n.value === "string") return n.value;
  if (n?.type === "TemplateLiteral") return (n.quasis as { value: { raw: string } }[]).map((q) => q.value.raw).join("?");
  return null;
}

export function auditPew(files: ReadonlyMap<string, string>, db: AuditDatabase) {
  const findings: { id: string; severity: "error"; stage: Stage; path: string; message: string }[] = [];
  const checks: { id: string; stage: Stage; status: "pass" | "fail" }[] = [];
  function check(id: string, stage: Stage, pass: boolean, path: string, message: string) {
    checks.push({ id, stage, status: pass ? "pass" : "fail" });
    // Output fixed messages and safe repo paths, never source snippets/errors.
    const safePath = /^[a-zA-Z0-9_./()[\]-]{1,220}$/.test(path) && !/(?:sk-|pk-|eyJ)/i.test(path) ? path : `sha256:${sha(path)}`;
    if (!pass) findings.push({ id, severity: "error", stage, path: safePath, message });
  }
  const ast = new Map<string, Node[]>();
  for (const [path, text] of [...files].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    if (!/\.(?:tsx?|mts|cts)$/.test(path)) continue;
    const result = parseSync(path, text);
    if (result.errors.length) check("source.parseable", "parser", false, path, "Source AST could not be parsed; details withheld.");
    const nodes: Node[] = [];
    visit(result.program, (node) => nodes.push(node));
    ast.set(path, nodes);
  }
  const nodes = (path: string) => ast.get(path) ?? [];
  const literals = (path: string) => nodes(path).map(literal).filter((s): s is string => s !== null);
  const awaited = (path: string, name: string) => nodes(path).filter((n) => n.type === "AwaitExpression" &&
    member((n.argument as Node)?.callee) === name).map((n) => n.start ?? 0);
  const sqlConstant = (path: string, name: string) => literal(nodes(path).find((n) => n.type === "VariableDeclarator" && member(n.id) === name)?.init as Node) ?? "";
  for (const stage of STAGES) check(`scope.${stage}`, stage, required[stage].every((p) => files.has(p)), required[stage][0], "Required accounting stage source is missing.");

  const evidenceSource = [...required.parser.slice(0, 3), "packages/cli/src/utils/usage-evidence.ts"];
  check("parser.source-time", "parser", evidenceSource.every((p) => !nodes(p).some((n) =>
    (n.type === "CallExpression" && member(n.callee) === "Date.now") ||
    (n.type === "NewExpression" && member(n.callee) === "Date" && (n.arguments as unknown[]).length === 0))),
    required.parser[2], "Supplementary evidence must use source times and source revisions, never collection time.");
  const adapter = required.parser[3];
  const constructors = nodes(adapter).filter((n) => n.type === "NewExpression" && ["Database", "DatabaseSync"].includes(member(n.callee)));
  check("parser.readonly-db", "parser", constructors.length === 2 && constructors.every((n) => {
    const options = (n.arguments as Node[])[1];
    return (options?.properties as Node[] | undefined)?.some((p) => ["readonly", "readOnly"].includes(member(p.key)) && (p.value as Node)?.value === true);
  }) && !literals(adapter).some((s) => /^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(s)), adapter, "Both native adapters must open source SQLite readonly and issue no writes.");
  check("parser.no-body-logging", "parser", evidenceSource.every((p) => !nodes(p).some((n) => n.type === "CallExpression" && /^console\./.test(member(n.callee)))), required.parser[1], "Supplementary parsers must not log source objects or bodies.");

  const sync = required.cursor[0];
  const merge = awaited(sync, "evidenceQueue.merge");
  const saves = awaited(sync, "cursorStore.save");
  check("cursor.evidence-before-commit", "cursor", merge.length === 1 && merge[0] < Math.max(...saves), sync, "Evidence ledger must finish before final cursor commit.");
  check("cursor.main-isolation", "cursor", nodes(sync).some((n) => n.type === "IfStatement" && member(n.test) === "delta.evidence" && (n.consequent as Node)?.type === "ContinueStatement"), sync, "Supplementary evidence must not also enter legacy summed buckets.");
  const reset = required.cursor[1];
  check("cursor.reset-preserves-evidence", "cursor", !literals(reset).some((s) => s.startsWith("evidence-queue")) && !nodes(reset).some((n) => n.type === "CallExpression" && /(?:^|\.)(?:rm|rmdir)$/.test(member(n.callee))), reset, "Reset must retain the durable evidence ledger and outbox.");
  const spool = required.spool[0];
  const dirty = awaited(spool, "this.saveDirtyKeys");
  const overwrite = awaited(spool, "this.overwrite");
  const base = required.spool[1];
  check("spool.atomic-outbox", "spool", dirty.length > 0 && overwrite.length > 0 && dirty[0] < overwrite[0] &&
    awaited(base, "writeFile")[0] < awaited(base, "rename")[0], spool, "Dirty intent must precede atomic ledger replacement.");
  const projection = nodes(required.spool[2]).find((n) => n.type === "FunctionDeclaration" && member(n.id) === "toEvidenceRecord");
  let spreads = 0;
  visit(projection, (n) => { if (n.type === "SpreadElement") spreads++; });
  check("spool.privacy-projection", "spool", !!projection && spreads === 0, required.spool[2], "Queue projection must enumerate allowed fields; raw-object spreads are forbidden.");
  const immutable = ["source", "model", "timestamp", "hour_start", "evidence.groupId", "evidence.callType", "evidence.origin",
    "evidence.provider", "evidence.granularity", "evidence.timePrecision", "evidence.intervalStart"];
  check("spool.immutable-metadata", "spool", immutable.every((field) => nodes(spool).some((n) => n.type === "BinaryExpression" && n.operator === "!==" &&
    member(n.left) === `r.${field}` && member(n.right) === `prev.${field}`)), spool, "Local snapshots must freeze the same event ownership, time and provenance as server UPSERTs.");
  const upload = required.upload[0];
  check("upload.separate-evidence", "upload", literals(upload).includes("/api/ingest/evidence") && nodes(upload).some((n) => n.type === "Property" && member(n.key) === "recordKey" && member(n.value) === "evidenceKey") &&
    nodes(upload).some((n) => n.type === "Property" && member(n.key) === "preprocess" && (n.value as Node)?.type === "ArrowFunctionExpression" && member((n.value as Node).body) === "records"), upload, "Evidence uploads need their own endpoint, stable key and no SUM preprocessing.");

  const migrationPath = required.worker[3];
  const migration = files.get(migrationPath) ?? "";
  const migrationCode = migration.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check("schema.additive", "worker", migrationCode.length > 0 && migrationCode.split(";").filter((s) => s.trim()).every((s) => /^\s*CREATE\s+(?:TABLE|INDEX|VIEW)\s+IF\s+NOT\s+EXISTS\b/i.test(s)), migrationPath, "The evidence migration must be additive and leave legacy records intact.");
  const evidenceSql = sqlConstant(required.worker[1], "EVIDENCE_UPSERT_SQL");
  const legacySql = sqlConstant(required.worker[0], "TOKEN_UPSERT_SQL");
  check("worker.validated-ingest", "worker", literals(required.worker[0]).includes("/ingest/evidence") &&
    nodes(required.worker[0]).some((n) => n.type === "CallExpression" && member(n.callee) === "validateRequest" &&
      (n.arguments as Node[]).some((a) => member(a) === "validateEvidenceRecord")) &&
    nodes(required.upload[2]).some((n) => n.type === "Property" && member(n.key) === "validateRecord" && member(n.value) === "validateEvidenceRecord"),
    required.worker[0], "Both evidence ingest boundaries must invoke the strict whitelist validator.");
  let convergence = false;
  let compatibility = false;
  let precision = false;
  try {
    db.exec(`PRAGMA foreign_keys = ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('audit-user');
      CREATE TABLE usage_records(user_id TEXT,device_id TEXT,source TEXT,model TEXT,hour_start TEXT,input_tokens INTEGER,
      cached_input_tokens INTEGER,output_tokens INTEGER,reasoning_output_tokens INTEGER,total_tokens INTEGER,created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id,device_id,source,model,hour_start));`);
    db.exec(migration);
    db.exec(migration); // replaying an additive migration is harmless
    const time = "2026-09-06T16:00:00.000Z";
    const legacy = ["audit-user", "audit-device", "hermes", "audit-model", time, 100, 0, 0, 0, 100];
    db.prepare(legacySql).run(...legacy);
    const put = (count: number, seq: number, timestamp = time, device = "audit-device") => db.prepare(evidenceSql).run(
      "audit-user", device, "a".repeat(64), "b".repeat(64), "hermes", "audit-model", timestamp, timestamp,
      "approval", "hermes-aux-ledger", "openai", "session", "session-start", time, time, 1, seq, count, 0, 0, 0, count);
    put(10, 1); put(20, 2); put(10, 1); put(20, 2); put(50, 3, "2026-09-07T16:00:00.000Z");
    const total = () => (db.prepare("SELECT SUM(total_tokens) AS n FROM usage_totals").get() as { n: number }).n;
    convergence = total() === 120;
    const row = db.prepare("SELECT COUNT(*) AS n,SUM(approximate_tokens) AS approximate FROM usage_totals").get() as { n: number; approximate: number };
    precision = row.n === 1 && row.approximate === 20;
    put(0, 1, time, "audit-zero-device");
    precision &&= (db.prepare("SELECT COUNT(*) AS n FROM usage_totals").get() as { n: number }).n === 1;
    db.prepare(legacySql).run(...legacy); // unchanged old-client contract
    compatibility = total() === 120 && (db.prepare("SELECT total_tokens AS n FROM usage_records").get() as { n: number }).n === 100;
    put(5, 1, time, "audit-second-device");
    compatibility &&= total() === 125;
    db.exec("DELETE FROM users WHERE id='audit-user'");
    compatibility &&= (db.prepare("SELECT COUNT(*) AS n FROM usage_evidence").get() as { n: number }).n === 0;
  } catch { /* malformed source SQL yields fixed findings, never SQL/errors */ }
  check("worker.snapshot-convergence", "worker", convergence, required.worker[1], "Native SQLite replay/stale-revision/time-ownership probe failed.");
  check("worker.legacy-compatibility", "worker", compatibility, migrationPath, "Legacy UPSERT, device isolation or account deletion compatibility failed.");
  check("api.bucket-and-precision", "api", precision, migrationPath, "Combined view must retain original bucket dimensions, precision counts and zero-checkpoint filtering.");

  const badRead = [...ast.keys()].filter((p) => /packages\/(?:worker-read\/src\/rpc|web\/src\/app\/api)\//.test(p) && !/\.test\./.test(p))
    .filter((p) => literals(p).some((s) => /\b(?:FROM|JOIN)\s+(?:["`]|\[)?usage_records\b/i.test(s) &&
      !(p === "packages/web/src/app/api/account/delete/route.ts" && /^DELETE FROM usage_records WHERE user_id = \?$/.test(s))));
  check("api.combined-read", "api", badRead.length === 0, badRead[0] ?? required.api[0], "A usage read bypasses the combined evidence view.");
  check("ui.timing-disclosure", "ui", required.ui.slice(1).every((p) => nodes(p).some((n) => n.type === "JSXOpeningElement" && (n.name as Node)?.name === "UsageTimingNotice")), required.ui[0], "Time charts must disclose approximate supplementary timing.");
  const validRecord = { source: "hermes", model: "audit-model", device_id: "audit-device", timestamp: "2026-09-06T16:00:00.000Z",
    hour_start: "2026-09-06T16:00:00.000Z", input_tokens: 10, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 10,
    evidence: { eventId: "a".repeat(64), groupId: "b".repeat(64), callType: "approval", origin: "hermes-aux-ledger", provider: "openai",
      granularity: "session", timePrecision: "session-start", intervalStart: null, intervalEnd: null, callCount: null, snapshotSeq: 1 } };
  const privacy = [{ ...validRecord, prompt: "SYNTHETIC_PRIVATE_BODY" },
    { ...validRecord, evidence: { ...validRecord.evidence, response: "SYNTHETIC_PRIVATE_BODY" } }].map((r) => validateEvidenceRecord(r, 0));
  check("worker.privacy-and-model-labels", "worker", validateEvidenceRecord(validRecord, 0).valid && privacy.every((v) => !v.valid) && !JSON.stringify(privacy).includes("SYNTHETIC_PRIVATE_BODY") &&
    usageLabel("Bearer SYNTHETIC_PRIVATE_BODY") === "unknown" && usageLabel("https://private.invalid") === "unknown" && usageLabel("provider/model-v1") === "provider/model-v1",
    required.worker[2], "Boundary validation must reject private payloads and project safe provider/model labels.");
  check("tests.required-suites", "parser", suites.every((p) => files.has(p) && nodes(p).some((n) => n.type === "CallExpression" && ["it", "test"].includes(member(n.callee)))), suites[0], "Required regression suite evidence is missing.");
  check("tests.no-skips", "parser", [...ast].filter(([p]) => /\.test\./.test(p)).every(([, ns]) => !ns.some((n) => n.type === "CallExpression" && /^(?:it|test|describe)\.(?:skip|only)$/.test(member(n.callee)))), suites[0], "Skipped or focused tests invalidate regression evidence.");

  const digests = [...files].sort(([a], [b]) => a.localeCompare(b, "en")).map(([path, text]) => [path, sha(text)]);
  return {
    schemaVersion: 1, readOnly: true, inputDigest: sha(JSON.stringify(digests)), stages: [...STAGES],
    threshold: { maximumErrors: 0, failureExit: 1, operationalErrorExit: 2 },
    scope: { sourceFiles: files.size, excluded: ["dependencies", "build", "cache", "private logs", "credentials", "symlinks", "production state"] },
    checks, findings, exitCode: findings.length ? 1 : 0,
    testEvidence: { fullSuite: "not-executed-by-audit", nativeSqliteProbes: ["worker.snapshot-convergence", "worker.legacy-compatibility", "api.bucket-and-precision"],
      suites: suites.map((path) => ({ path, digest: files.has(path) ? sha(files.get(path) as string) : null })) },
    limitations: ["Static checks and in-memory probes do not replace full tests or independent reviews.",
      "Complexity suggestions require human inspection; no automatic edits or source excerpts.",
      "No production data or historical upload is inspected or changed."],
  };
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 2) throw new Error();
    const { Database } = await import("bun:sqlite");
    const db = new Database(":memory:");
    try {
      const report = auditPew(readAuditInputs(resolve(dirname(fileURLToPath(import.meta.url)), "..")), db as unknown as AuditDatabase);
      process.stdout.write(`${JSON.stringify(report)}\n`);
      process.exitCode = report.exitCode;
    } finally { db.close(); }
  } catch {
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, readOnly: true, exitCode: 2, error: "Audit could not complete; source and error details withheld." })}\n`);
    process.exitCode = 2;
  }
}
