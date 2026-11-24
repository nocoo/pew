type Statement = { bind(...values: unknown[]): Statement; run(): Promise<unknown> };
type Database = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown>;
};

export async function seedReadiness(db: Database, userId: string): Promise<Record<string, string>> {
  const peerId = `${userId}-peer`;
  const teamId = "readiness-team";
  const seasonId = "readiness-season";
  const profileSlug = "readiness-user";
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setUTCMinutes(0, 0, 0);
  const start = new Date(currentHour.getTime() - 7 * 86_400_000).toISOString();
  const end = new Date(currentHour.getTime() + 7 * 86_400_000).toISOString();
  const sql = (query: string, ...params: unknown[]) => db.prepare(query).bind(...params);
  await db.batch([
    sql(
      "UPDATE users SET slug=?, is_public=1, cli_upgrade_notice_seen_at=? WHERE id=?",
      profileSlug,
      now.toISOString(),
      userId,
    ),
    sql(
      "INSERT INTO users(id,email,name,slug,is_public,cli_upgrade_notice_seen_at) VALUES (?,?,?,'readiness-peer',1,?)",
      peerId,
      `${peerId}@test.invalid`,
      "Readiness Peer",
      now.toISOString(),
    ),
    sql(
      "INSERT INTO teams(id,name,slug,invite_code,created_by,created_at) VALUES (?,'Readiness Team',?,'readiness-team-invite',?,?)",
      teamId,
      teamId,
      userId,
      start,
    ),
    sql(
      "INSERT INTO team_members(id,team_id,user_id,role,joined_at) VALUES ('readiness-member',?,?,'owner',?)",
      teamId,
      userId,
      start,
    ),
    sql(
      "INSERT INTO organizations(id,name,slug,created_by) VALUES ('readiness-org','Readiness Organization','readiness-org',?)",
      userId,
    ),
    sql(
      "INSERT INTO organization_members(id,org_id,user_id) VALUES ('readiness-org-member','readiness-org',?)",
      userId,
    ),
    sql(
      "INSERT INTO seasons(id,name,slug,start_date,end_date,created_by) VALUES (?,'Readiness Season',?,?,?,?)",
      seasonId,
      seasonId,
      start,
      end,
      userId,
    ),
    sql(
      "INSERT INTO season_teams(id,season_id,team_id,registered_by,registered_at) VALUES ('readiness-registration',?,?,?,?)",
      seasonId,
      teamId,
      userId,
      start,
    ),
    sql(
      "INSERT INTO season_team_members(id,season_id,team_id,user_id,joined_at) VALUES ('readiness-roster',?,?,?,?)",
      seasonId,
      teamId,
      userId,
      start,
    ),
    sql("INSERT INTO invite_codes(code,created_by) VALUES ('PEW-RDY1',?)", userId),
  ]);
  const statements: Statement[] = [];
  for (const owner of [userId, peerId]) {
    for (const [index, device, alias, source, model] of [
      [0, "readiness-work", "Readiness Work", "claude-code", "claude-opus-4.6-1m"],
      [1, "readiness-home", "Readiness Home", "codex", "gpt-5.4"],
    ] as const) {
      statements.push(
        sql(
          "INSERT INTO device_aliases(user_id,device_id,alias) VALUES (?,?,?)",
          owner,
          device,
          alias,
        ),
      );
      for (const hoursAgo of [0, 24]) {
        const hour = new Date(currentHour.getTime() - hoursAgo * 3_600_000).toISOString();
        statements.push(
          sql(
            `INSERT INTO usage_records(user_id,device_id,source,model,hour_start,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens)
          VALUES (?,?,?,?,?,300000,100000,40000,10000,450000)`,
            owner,
            device,
            source,
            model,
            hour,
          ),
        );
        statements.push(
          sql(
            `INSERT INTO session_records(user_id,session_key,source,started_at,last_message_at,duration_seconds,user_messages,assistant_messages,total_messages,model,snapshot_at)
          VALUES (?,?,?,?,?,1800,5,5,10,?,?)`,
            owner,
            `${owner}-${index}-${hoursAgo}`,
            source,
            hour,
            new Date(new Date(hour).getTime() + 1_800_000).toISOString(),
            model,
            now.toISOString(),
          ),
        );
      }
    }
  }
  await db.batch(statements);
  return {
    E2E_READINESS_TEAM_ID: teamId,
    E2E_READINESS_SEASON_SLUG: seasonId,
    E2E_READINESS_PROFILE_SLUG: profileSlug,
    E2E_READINESS_PEER_ID: peerId,
  };
}
