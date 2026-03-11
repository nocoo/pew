/**
 * Cloudflare R2 client for team logo storage.
 *
 * Uses the same R2 bucket/credentials as otter's icon storage.
 * Logos are stored at: apps/pew/teams-logo/{teamId}.jpg
 * Served via: https://s.zhe.to/apps/pew/teams-logo/{teamId}.jpg
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
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

/** R2 object key for a team logo */
export function teamLogoKey(teamId: string): string {
  return `${LOGO_PREFIX}/${teamId}.jpg`;
}

/** Public CDN URL for a team logo */
export function teamLogoUrl(teamId: string): string {
  return `${CDN_BASE}/${teamLogoKey(teamId)}`;
}

/** Store a team logo JPG in R2 (overwrites existing) */
export async function putTeamLogo(
  teamId: string,
  data: Buffer,
): Promise<void> {
  const { client, bucket } = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: teamLogoKey(teamId),
      Body: data,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=3600",
    }),
  );
}

/** Delete a team logo from R2 */
export async function deleteTeamLogo(teamId: string): Promise<void> {
  const { client, bucket } = getClient();

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: teamLogoKey(teamId),
    }),
  );
}

/** Check if a team logo exists in R2 */
export async function teamLogoExists(teamId: string): Promise<boolean> {
  const { client, bucket } = getClient();

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: teamLogoKey(teamId),
      }),
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "NotFound") {
      return false;
    }
    throw error;
  }
}
