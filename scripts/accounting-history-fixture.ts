import type { D1Database } from "../packages/worker/node_modules/@cloudflare/workers-types";
import { accountingFixture } from "../packages/core/src/__test-helpers__/accounting";

export const HISTORY_ROWS = 4000;

/** Dense events cross the daily D1 limit while older buckets exercise all-time reads. */
export async function seedAccountingHistory(db: D1Database, userId: string) {
  const fixture = accountingFixture();
  const hour =
    "strftime('%Y-%m-%dT%H:%M:00.000Z','2020-01-01', (CASE WHEN i<1000 THEN i*30 ELSE 30000 END) || ' minutes')";
  const sequence = `WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<${HISTORY_ROWS - 1})`;
  await db.batch([
    db
      .prepare(`${sequence} INSERT INTO usage_evidence(user_id,device_id,event_id,group_id,source,model,hour_start,
      timestamp,call_type,origin,provider,granularity,time_precision,call_count,snapshot_seq,
      input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens)
      SELECT ?,'history-device',printf('%064x',i+1),printf('%064x',i+1),'codex','gpt-6-astra',${hour},
        ${hour},'compaction','codex-session','openai','operation','exact',1,1,100,800,30,10,940 FROM n`)
      .bind(userId),
    db
      .prepare(`INSERT INTO usage_details(user_id,device_id,source,model,hour_start,event_id,evidence_snapshot_seq,details_version,source_revision,parser_revision,detail_revision,
      input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens,groups_json)
      SELECT user_id,device_id,source,model,hour_start,event_id,1,1,1,1,1,100,800,30,10,940,?
      FROM usage_evidence WHERE user_id=? AND device_id='history-device'`)
      .bind(JSON.stringify(fixture.groups), userId),
    db
      .prepare(
        "INSERT INTO usage_records(user_id,device_id,source,model,hour_start,input_tokens,total_tokens) VALUES (?,'empty-details','pi','gpt-6-astra','2020-01-01T00:00:00.000Z',11,11)",
      )
      .bind(userId),
  ]);
}
