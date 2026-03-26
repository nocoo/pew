#!/usr/bin/env bun
/**
 * One-off script: clear all usage_records from D1.
 *
 * Reads Cloudflare credentials from packages/web/.env.local.
 * Usage: bun scripts/clear-d1-usage.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Load .env.local manually (no dotenv dependency)
// ---------------------------------------------------------------------------

const envPath = resolve(import.meta.dirname as string, "../packages/web/.env.local");
const envContent = readFileSync(envPath, "utf-8");
const envVars: Record<string, string> = {};
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  envVars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
}

const CF_ACCOUNT_ID = envVars.CF_ACCOUNT_ID;
const CF_D1_DATABASE_ID = envVars.CF_D1_DATABASE_ID;
const CF_D1_API_TOKEN = envVars.CF_D1_API_TOKEN;

if (!CF_ACCOUNT_ID || !CF_D1_DATABASE_ID || !CF_D1_API_TOKEN) {
  console.error("Missing Cloudflare D1 credentials in .env.local");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Query current state
// ---------------------------------------------------------------------------

const D1_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`;

async function d1Query(sql: string, params: unknown[] = []) {
  const resp = await fetch(D1_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CF_D1_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, params }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`D1 API error (${resp.status}): ${text}`);
  }

  return resp.json();
}

// Count before
console.log("Querying current usage_records count...");
const countResult = await d1Query("SELECT COUNT(*) as cnt FROM usage_records");
const count =
  (countResult as { result: Array<{ results: Array<{ cnt: number }> }> })
    .result[0]?.results[0]?.cnt ?? "?";
console.log(`Found ${count} usage_records`);

if (count === 0) {
  console.log("Nothing to delete. Done.");
  process.exit(0);
}

// Delete
console.log("Deleting all usage_records...");
const deleteResult = await d1Query("DELETE FROM usage_records");
console.log("Delete result:", JSON.stringify(deleteResult, null, 2));

// Verify
const verifyResult = await d1Query("SELECT COUNT(*) as cnt FROM usage_records");
const afterCount =
  (verifyResult as { result: Array<{ results: Array<{ cnt: number }> }> })
    .result[0]?.results[0]?.cnt ?? "?";
console.log(`After delete: ${afterCount} usage_records`);
console.log("Done!");
