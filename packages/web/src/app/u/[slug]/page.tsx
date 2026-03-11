import type { Metadata } from "next";
import { getD1Client } from "@/lib/d1";
import { PublicProfileView } from "./profile-view";

// ---------------------------------------------------------------------------
// Dynamic metadata for SEO / social sharing
// ---------------------------------------------------------------------------

interface UserMeta {
  name: string | null;
  slug: string;
  is_public?: number | null;
}

const GENERIC_METADATA: Metadata = {
  title: "Profile — pew",
  description: "Public profile on pew",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  const client = getD1Client();

  let user: UserMeta | null = null;
  let hasIsPublicColumn = true;

  try {
    user = await client.firstOrNull<UserMeta>(
      "SELECT name, slug, is_public FROM users WHERE slug = ?",
      [slug],
    );
  } catch (err: unknown) {
    // Fallback: is_public column doesn't exist yet (pre-migration)
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("no such column")) {
      hasIsPublicColumn = false;
      user = await client
        .firstOrNull<UserMeta>(
          "SELECT name, slug FROM users WHERE slug = ?",
          [slug],
        )
        .catch(() => null);
    } else {
      // Unexpected error — return generic metadata (don't leak name)
      return GENERIC_METADATA;
    }
  }

  // If user not found or not public, return generic metadata (don't leak name)
  if (!user || (hasIsPublicColumn && !user.is_public)) {
    return GENERIC_METADATA;
  }

  const displayName = user.name ?? slug;

  return {
    title: `${displayName} — pew`,
    description: `See how ${displayName} wields AI`,
    openGraph: {
      title: `${displayName} — pew`,
      description: `See how ${displayName} wields AI`,
    },
  };
}

// ---------------------------------------------------------------------------
// Page (Server Component shell → Client Component body)
// ---------------------------------------------------------------------------

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PublicProfileView slug={slug} />;
}
