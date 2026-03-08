/**
 * Zebra Ingest Worker — Cloudflare Worker with native D1 bindings.
 *
 * Receives pre-validated usage records from Next.js and performs
 * atomic batch upserts via env.DB.batch().
 */

export interface Env {
  DB: D1Database;
  WORKER_SECRET: string;
}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    // Implementation in next commit
    return new Response("Not implemented", { status: 501 });
  },
} satisfies ExportedHandler<Env>;
