import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { auditPew, readAuditInputs, type AuditDatabase } from "../ponytail-audit";

const root = resolve(import.meta.dirname, "../..");
const run = (files = readAuditInputs(root)) => {
  const db = new DatabaseSync(":memory:");
  try { return auditPew(files, db as unknown as AuditDatabase); }
  finally { db.close(); }
};
const mutate = (path: string, change: (text: string) => string) => {
  const files = readAuditInputs(root);
  files.set(path, change(files.get(path) ?? ""));
  return files;
};
const hasError = (report: ReturnType<typeof run>, id: string) => report.findings.some((f) => f.id === id && f.severity === "error");

describe("Pew ponytail readonly audit", () => {
  let temporary: string | undefined;
  afterEach(() => { if (temporary) rmSync(temporary, { recursive: true, force: true }); });

  it("reads only repository source inputs and never follows links to private data or scans build/cache/logs", () => {
    temporary = mkdtempSync(join(tmpdir(), "pew-audit-"));
    const put = (path: string, text = "PRIVATE_FIXTURE_BODY") => {
      const full = join(temporary as string, path);
      mkdirSync(resolve(full, ".."), { recursive: true });
      writeFileSync(full, text);
    };
    put("packages/cli/src/parser.ts", "export const n = 1;");
    for (const path of [".env", "node_modules/private.ts", "packages/cli/dist/private.ts", "packages/cli/src/cache/private.ts",
      "packages/cli/src/logs/private.ts", "packages/cli/src/session.jsonl", "outside/private.ts", "outside/src/private.ts"]) put(path);
    symlinkSync(join(temporary, "outside/private.ts"), join(temporary, "packages/cli/src/link.ts"));
    symlinkSync(join(temporary, "outside"), join(temporary, "packages/cli/src/linked-directory"));
    symlinkSync(join(temporary, "outside"), join(temporary, "packages/core"));
    const files = readAuditInputs(temporary);
    expect([...files.keys()]).toEqual(["packages/cli/src/parser.ts"]);
    expect(JSON.stringify([...files])).not.toContain("PRIVATE_FIXTURE_BODY");
  });

  it("covers every accounting layer and produces deterministic JSON without reading test caches", () => {
    const files = readAuditInputs(root);
    const first = run(files);
    expect(first.exitCode).toBe(0);
    expect(first.readOnly).toBe(true);
    expect(first.stages).toEqual(["parser", "cursor", "spool", "upload", "worker", "api", "ui"]);
    expect(first.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.testEvidence.fullSuite).toBe("not-executed-by-audit");
    expect(run(new Map([...files].reverse()))).toEqual(first);
    expect([...files.keys()].some((path) => /node_modules|\.git\/info|\.env|\.jsonl$/.test(path))).toBe(false);
  });

  it("detects an old snapshot overwriting a newer one using the actual UPSERT in memory", () => {
    const files = mutate("packages/worker/src/evidence-sql.ts", (s) => s.replace("excluded.snapshot_seq > usage_evidence.snapshot_seq", "excluded.snapshot_seq < usage_evidence.snapshot_seq"));
    const report = run(files);
    expect(hasError(report, "worker.snapshot-convergence")).toBe(true);
    expect(report.exitCode).toBe(1);
  });

  it("rejects destructive migration changes and does not print source contents", () => {
    const report = run(mutate("scripts/migrations/022-usage-evidence.sql", (s) => `${s}\nDROP TABLE usage_records; -- PRIVATE_FIXTURE_BODY`));
    expect(hasError(report, "schema.additive")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_FIXTURE_BODY");
  });

  it("finds legacy-only read queries in any API source while ignoring comments", () => {
    const files = readAuditInputs(root);
    const path = "packages/web/src/app/api/audit-fixture/route.ts";
    files.set(path, "// SELECT * FROM usage_records\nexport const n = 1;");
    expect(run(files).exitCode).toBe(0);
    files.set(path, "export const sql = `SELECT SUM(total_tokens) FROM usage_records WHERE user_id = ?`; // PRIVATE_FIXTURE_BODY");
    const report = run(files);
    expect(hasError(report, "api.combined-read")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_FIXTURE_BODY");
  });

  it("catches the evidence cursor committing before its ledger promise completes", () => {
    const report = run(mutate("packages/cli/src/commands/sync.ts", (s) => s.replace("await evidenceQueue.merge(evidenceRecords, initialCursorEmpty)", "evidenceQueue.merge(evidenceRecords, initialCursorEmpty)")));
    expect(hasError(report, "cursor.evidence-before-commit")).toBe(true);
  });

  it("catches collection time in supplementary identities and a raw-object spread in the queue projection", () => {
    const clock = run(mutate("packages/cli/src/parsers/hermes-usage-evidence.ts", (s) => `${s}\nconst unsafeRevision = Date.now();`));
    expect(hasError(clock, "parser.source-time")).toBe(true);
    const privacy = run(mutate("packages/cli/src/utils/usage-evidence.ts", (s) => s.replace("source: delta.source,", "...delta, source: delta.source,")));
    expect(hasError(privacy, "spool.privacy-projection")).toBe(true);
  });

  it("requires local and server snapshots to freeze the same provenance fields", () => {
    const report = run(mutate("packages/cli/src/storage/evidence-queue.ts", (s) => s.replace("r.evidence.provider !== prev.evidence.provider ||", "")));
    expect(hasError(report, "spool.immutable-metadata")).toBe(true);
  });

  it("fails closed for missing test evidence, skipped tests and missing UI timing disclosure", () => {
    const files = readAuditInputs(root);
    files.delete("packages/cli/src/__tests__/pi-compaction.test.ts");
    expect(hasError(run(files), "tests.required-suites")).toBe(true);
    const skipped = run(mutate("packages/cli/src/__tests__/hermes-auxiliary-usage.test.ts", (s) => s.replace('it("captures', 'it.skip("captures')));
    expect(hasError(skipped, "tests.no-skips")).toBe(true);
    const ui = run(mutate("packages/web/src/app/(dashboard)/daily-usage/page.tsx", (s) => s.replace("<UsageTimingNotice records={data?.records} />", "")));
    expect(hasError(ui, "ui.timing-disclosure")).toBe(true);
  });
});
