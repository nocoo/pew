"use client";

import { useState } from "react";
import { Users, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// LogoImg — internal img component that tracks its own error state
// ---------------------------------------------------------------------------

function LogoImg({
  src,
  alt,
  className,
  fallback,
}: {
  src: string;
  alt: string;
  className: string;
  fallback: React.ReactNode;
}) {
  const [error, setError] = useState(false);

  if (error) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external logos, can't use next/image
    <img src={src} alt={alt} className={className} onError={() => setError(true)} />
  );
}

// ---------------------------------------------------------------------------
// TeamLogoIcon
// ---------------------------------------------------------------------------

export function TeamLogoIcon({
  logoUrl,
  name,
  className,
}: {
  logoUrl: string | null;
  name: string;
  className?: string;
}) {
  const fallback = <Users className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} strokeWidth={1.5} />;

  if (!logoUrl) return fallback;

  // key={logoUrl} forces remount when URL changes, resetting error state
  return (
    <LogoImg
      key={logoUrl}
      src={logoUrl}
      alt={name}
      className={cn("h-3.5 w-3.5 shrink-0 rounded-sm object-cover", className)}
      fallback={fallback}
    />
  );
}

// ---------------------------------------------------------------------------
// TeamLogoBadge — tiny inline logo for team badges in leaderboard rows
// ---------------------------------------------------------------------------

export function TeamLogoBadge({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  if (!logoUrl) return null;

  // key={logoUrl} forces remount when URL changes, resetting error state
  return (
    <LogoImg
      key={logoUrl}
      src={logoUrl}
      alt={name}
      className="h-2.5 w-2.5 shrink-0 rounded-[2px] object-cover"
      fallback={null}
    />
  );
}

// ---------------------------------------------------------------------------
// OrgLogoIcon
// ---------------------------------------------------------------------------

export function OrgLogoIcon({
  logoUrl,
  name,
  className,
}: {
  logoUrl: string | null;
  name: string;
  className?: string;
}) {
  const fallback = <Building2 className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} strokeWidth={1.5} />;

  if (!logoUrl) return fallback;

  // key={logoUrl} forces remount when URL changes, resetting error state
  return (
    <LogoImg
      key={logoUrl}
      src={logoUrl}
      alt={name}
      className={cn("h-3.5 w-3.5 shrink-0 rounded-sm object-cover", className)}
      fallback={fallback}
    />
  );
}
