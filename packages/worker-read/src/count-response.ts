const COUNT_FIELDS = new Set([
  "input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens",
  "input_total_tokens", "output_total_tokens", "cache_read_input_tokens", "cache_write_input_tokens",
  "cache_write_5m_input_tokens", "cache_write_1h_input_tokens", "context_tokens_min", "context_tokens_max",
  "raw_total_tokens", "evidence_tokens", "approximate_tokens", "tokens_7d", "tokens_30d", "tokens_last_hour",
  "duration_seconds", "total_duration_seconds", "user_messages", "assistant_messages", "total_messages",
  "request_count", "call_count", "count", "cnt", "total_sessions", "session_count", "active_sessions",
  "total_users", "active_users_24h", "requests_last_hour", "unique_users_last_hour", "team_count",
  "device_count", "model_count", "usage_row_count", "evidence_snapshot_seq", "snapshot_seq",
  "source_revision", "parser_revision", "detail_revision",
].flatMap((name) => [name, name.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase())]));

class UnsafeCountError extends Error {}

function safeCounts(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(safeCounts);
  if (value === null || typeof value !== "object") return true;
  return Object.entries(value).every(([key, count]) => {
    if (COUNT_FIELDS.has(key)) return count === null || (typeof count === "number" && Number.isSafeInteger(count) && count >= 0);
    return safeCounts(count);
  });
}

function requireSafeCounts(value: unknown): void {
  if (!safeCounts(value)) throw new UnsafeCountError("Count exceeds supported integer range");
}

const statementGuard: ProxyHandler<D1PreparedStatement> = {
  get(target, property) {
    if (property === "bind") return (...values: unknown[]) => new Proxy(target.bind(...values), statementGuard);
    if (property === "first") return async (column?: string) => {
      const result = column === undefined ? await target.first() : await target.first(column);
      requireSafeCounts(column === undefined ? result : { [column]: result });
      return result;
    };
    if (property === "all") return async () => {
      const result = await target.all();
      requireSafeCounts(result);
      return result;
    };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  },
};

// Validate before Response.json can turn non-finite historical SQL counts into null.
export function checkedCountDatabase(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare") return (sql: string) => new Proxy(target.prepare(sql), statementGuard);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export async function checkedCountResponse(result: Promise<Response>): Promise<Response> {
  try {
    const response = await result;
    if (!response.ok) return response;
    const body = await response.text();
    requireSafeCounts(JSON.parse(body));
    return new Response(body, response);
  } catch (error) {
    return Response.json({ error: error instanceof UnsafeCountError ? error.message : "Internal server error" }, { status: 500 });
  }
}
