/**
 * Cloudflare D1 HTTP API client.
 *
 * Runs from Railway (or any Node.js host) and communicates with D1
 * via the Cloudflare REST API.
 *
 * @see https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface D1Config {
  accountId: string;
  databaseId: string;
  apiToken: string;
}

export interface D1Meta {
  changes: number;
  duration: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

export interface D1QueryResult<T = Record<string, unknown>> {
  results: T[];
  meta: D1Meta;
}

export interface D1BatchStatement {
  sql: string;
  params?: unknown[];
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class D1Error extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly errors?: Array<{ message: string }>
  ) {
    super(message);
    this.name = "D1Error";
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class D1Client {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: D1Config) {
    if (!config.accountId) throw new Error("accountId is required");
    if (!config.databaseId) throw new Error("databaseId is required");
    if (!config.apiToken) throw new Error("apiToken is required");

    this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}`;
    this.headers = {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Execute a read query and return typed results.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<D1QueryResult<T>> {
    const body = JSON.stringify({ sql, params });
    const data = await this.request(`${this.baseUrl}/query`, body);

    const first = data.result?.[0];
    return {
      results: (first?.results ?? []) as T[],
      meta: first?.meta ?? { changes: 0, duration: 0 },
    };
  }

  /**
   * Execute a write query (INSERT, UPDATE, DELETE) and return meta.
   */
  async execute(sql: string, params: unknown[] = []): Promise<D1Meta> {
    const result = await this.query(sql, params);
    return result.meta;
  }

  async batch(
    statements: D1BatchStatement[]
  ): Promise<D1QueryResult[]> {
    if (statements.length === 0) return [];
    const data = await this.request(`${this.baseUrl}/query`, JSON.stringify({
      batch: statements.map(({ sql, params = [] }) => ({ sql, params })),
    }));
    if (data.result?.length !== statements.length || data.result.some((result) => result.success === false)) {
      throw new D1Error("Invalid D1 batch result");
    }
    return data.result.map((result) => ({
      results: (result.results ?? []) as Record<string, unknown>[],
      meta: result.meta ?? { changes: 0, duration: 0 },
    }));
  }

  /**
   * Convenience: return the first row or null.
   */
  async firstOrNull<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.results[0] ?? null;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async request(url: string, body: string): Promise<{
    success: boolean;
    result?: Array<{ success?: boolean; results?: unknown[]; meta?: D1Meta }>;
    errors?: Array<{ message: string }>;
  }> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: this.headers,
        body,
      });
    } catch (err) {
      throw new D1Error(
        `D1 network error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const data = await response.json();

    if (!response.ok || !data.success) {
      const msg =
        data.errors?.[0]?.message ?? `D1 HTTP ${response.status}`;
      throw new D1Error(msg, response.status, data.errors);
    }

    return data;
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _client: D1Client | null = null;

/**
 * Get or create the D1 client singleton.
 * Reads config from environment variables.
 */
export function getD1Client(): D1Client {
  if (!_client) {
    _client = new D1Client({
      accountId: process.env.CF_ACCOUNT_ID ?? "",
      databaseId: process.env.CF_D1_DATABASE_ID ?? "",
      apiToken: process.env.CF_D1_API_TOKEN ?? "",
    });
  }
  return _client;
}

/** Reset singleton (for testing). */
export function resetD1Client(): void {
  _client = null;
}
