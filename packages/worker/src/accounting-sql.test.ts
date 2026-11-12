import { describe, expect, it, vi } from "vitest";
import type { AccountingRecord } from "@pew/core";
import { ingestAccounting } from "./accounting-sql";
import { accountingFixture } from "../../core/src/__test-helpers__/accounting";

// The ack status is decided from the stored row, not from SQL success: a batch
// that silently no-ops must not be acknowledged as applied. These cases pin the
// two statuses that only appear when the stored row is *newer* than the upload
// (superseded) or differs in a way no revision explains (conflict).
function stateFor(record: AccountingRecord, patch: Record<string, unknown> = {}) {
  return {
    ...record.basis,
    evidence_snapshot_seq: record.evidence_snapshot_seq,
    source_revision: record.source_revision,
    parser_revision: record.parser_revision,
    detail_revision: record.detail_revision,
    groups_json: "",
    base_matches: 1,
    device_revoked: 0,
    ...patch,
  };
}

function dbReturning(rows: Array<{ state: Record<string, unknown> }>) {
  const batch = vi.fn().mockResolvedValue(
    rows.flatMap((row) => [
      { results: [], success: true, meta: {} },
      { results: [row.state], success: true, meta: {} },
    ]),
  );
  const prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({}) });
  return { db: { prepare, batch } as unknown as D1Database, batch };
}

const record = () => accountingFixture() as unknown as AccountingRecord;

describe("accounting acknowledgment status", () => {
  it("marks an upload superseded when the stored row carries a newer source revision", async () => {
    const r = record();
    const { db } = dbReturning([{ state: stateFor(r, { source_revision: r.source_revision + 1 }) }]);
    const [ack] = await ingestAccounting(db, "u1", [r]);
    expect(ack?.status).toBe("superseded");
  });

  it("marks an upload superseded when only the stored parser revision is newer", async () => {
    const r = record();
    const { db } = dbReturning([{ state: stateFor(r, { parser_revision: r.parser_revision + 1 }) }]);
    const [ack] = await ingestAccounting(db, "u1", [r]);
    expect(ack?.status).toBe("superseded");
  });

  it("marks an upload superseded when the same source carries a newer detail revision", async () => {
    const r = record();
    const { db } = dbReturning([{ state: stateFor(r, { detail_revision: r.detail_revision + 1 }) }]);
    const [ack] = await ingestAccounting(db, "u1", [r]);
    expect(ack?.status).toBe("superseded");
  });

  it("marks an upload conflict when the stored basis differs and nothing supersedes it", async () => {
    const r = record();
    // base_matches is 1 (the row exists for this basis) but the stored counters
    // no longer equal this record's basis, so no revision ordering explains the
    // difference: that is a conflict, not a supersede and not a base mismatch.
    const { db } = dbReturning([{ state: stateFor(r, { input_tokens: r.basis.input_tokens + 1 }) }]);
    const [ack] = await ingestAccounting(db, "u1", [r]);
    expect(ack?.status).toBe("conflict");
  });

  it("keeps every record's status independent inside one batch", async () => {
    const applied = record();
    const stale = record();
    const { db } = dbReturning([]);
    vi.mocked(db.batch).mockResolvedValueOnce([
      { results: [{ source_revision: 1 }], success: true, meta: {} },
      { results: [stateFor(applied)], success: true, meta: {} },
      { results: [], success: true, meta: {} },
      { results: [stateFor(stale, { source_revision: stale.source_revision + 5 })], success: true, meta: {} },
    ] as unknown as D1Result[]);
    const acks = await ingestAccounting(db, "u1", [applied, stale]);
    expect(acks.map((ack) => ack.status)).toEqual(["applied", "superseded"]);
  });
});
