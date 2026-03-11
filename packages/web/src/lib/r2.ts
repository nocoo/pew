/**
 * Cloudflare R2 client for team logo storage.
 *
 * Uses the same R2 bucket/credentials as otter's icon storage.
 * Logos are stored at: apps/pew/teams-logo/{teamId}/{uniqueId}.jpg
 * Served via: https://s.zhe.to/apps/pew/teams-logo/{teamId}/{uniqueId}.jpg
 *
 * Each upload gets a unique filename so CDN caches never serve stale logos.
 * The full URL is persisted in the teams.logo_url column.
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LOGO_PREFIX = "apps/pew/teams-logo";
const CDN_BASE = "https://s.zhe.to";

interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

let _client: S3Client | null = null;
let _bucket: string | null = null;

function parseConfig(): R2Config {
  const endpoint = process.env.CF_R2_ENDPOINT;
  const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CF_R2_BUCKET;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "Missing R2 env vars: CF_R2_ENDPOINT, CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY, CF_R2_BUCKET",
    );
  }

  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

function getClient(): { client: S3Client; bucket: string } {
  if (_client && _bucket) {
    return { client: _client, bucket: _bucket };
  }

  const config = parseConfig();
  _client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  _bucket = config.bucket;

  return { client: _client, bucket: _bucket };
}

/** Reset singleton (for testing). */
export function __resetR2ClientForTests(): void {
  _client = null;
  _bucket = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Generate a unique R2 key for a new team logo upload. */
export function generateLogoKey(teamId: string): string {
  const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${LOGO_PREFIX}/${teamId}/${uniqueId}.jpg`;
}

/** Public CDN URL for a given R2 key. */
export function logoKeyToUrl(key: string): string {
  return `${CDN_BASE}/${key}`;
}

/** Extract R2 key from a full CDN URL. Returns null if not a valid logo URL. */
export function logoUrlToKey(url: string): string | null {
  const prefix = `${CDN_BASE}/`;
  if (!url.startsWith(prefix)) return null;
  return url.slice(prefix.length);
}

/**
 * Store a team logo JPG in R2 with immutable caching.
 * Returns the full CDN URL.
 */
export async function putTeamLogo(
  teamId: string,
  data: Buffer,
): Promise<string> {
  const { client, bucket } = getClient();
  const key = generateLogoKey(teamId);

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return logoKeyToUrl(key);
}

/** Delete a team logo from R2 by its CDN URL. No-op if url is null/invalid. */
export async function deleteTeamLogoByUrl(url: string | null): Promise<void> {
  if (!url) return;
  const key = logoUrlToKey(url);
  if (!key) return;

  const { client, bucket } = getClient();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}
