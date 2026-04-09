import type { Metadata } from "next";
import { getDbRead } from "@/lib/db";
import { PublicProfileView } from "./profile-view";

// ---------------------------------------------------------------------------
// Dynamic metadata for SEO / social sharing
// ---------------------------------------------------------------------------

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

  const db = await getDbRead();

  // Look up user by slug or id
  const user = await db.getPublicUserBySlugOrId(slug);

  // If user not found or not public, return generic metadata (don't leak name)
  if (!user || !user.is_public) {
    return GENERIC_METADATA;
  }

  const displayName = user.name ?? user.slug ?? slug;

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
