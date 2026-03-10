import type { Metadata } from "next";
import { getD1Client } from "@/lib/d1";
import { PublicProfileView } from "./profile-view";

// ---------------------------------------------------------------------------
// Dynamic metadata for SEO / social sharing
// ---------------------------------------------------------------------------

interface UserMeta {
  name: string | null;
  slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  const client = getD1Client();
  const user = await client
    .firstOrNull<UserMeta>(
      "SELECT name, slug FROM users WHERE slug = ?",
      [slug],
    )
    .catch(() => null);

  const displayName = user?.name ?? slug;

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
