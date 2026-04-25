"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Building2, Users, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  memberCount: number;
}

interface OrgMember {
  id: string;
  userId: string;
  joinedAt: string;
  user: {
    id: string;
    name: string | null;
    image: string | null;
    slug: string | null;
  };
}

// ---------------------------------------------------------------------------
// Organizations Settings Page
// ---------------------------------------------------------------------------

export default function OrganizationsPage() {
  const { data: allData, error: allError, isLoading: allLoading, mutate: mutateAll } =
    useSWR<{ organizations: Organization[] }>("/api/organizations", fetcher);
  const { data: mineData, error: mineError, isLoading: mineLoading, mutate: mutateMine } =
    useSWR<{ organizations: Organization[] }>("/api/organizations/mine", fetcher);

  const [overrides, setOverrides] = useState<
    Map<string, { joined: boolean; delta: number }>
  >(new Map());
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const baseMyOrgIds = useMemo(
    () => new Set((mineData?.organizations ?? []).map((o) => o.id)),
    [mineData],
  );

  const myOrgIds = useMemo(() => {
    const set = new Set(baseMyOrgIds);
    for (const [id, ov] of overrides) {
      if (ov.joined) set.add(id);
      else set.delete(id);
    }
    return set;
  }, [baseMyOrgIds, overrides]);

  const organizations = useMemo(() => {
    const base = allData?.organizations ?? [];
    return base.map((o) => {
      const ov = overrides.get(o.id);
      return ov ? { ...o, memberCount: Math.max(0, o.memberCount + ov.delta) } : o;
    });
  }, [allData, overrides]);

  const loading = allLoading || mineLoading;
  const error = allError || mineError ? "Failed to load organizations" : null;

  // Members modal state
  const [membersModalOrg, setMembersModalOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // ---------------------------------------------------------------------------
  // Join / Leave
  // ---------------------------------------------------------------------------

  const handleJoin = async (orgId: string) => {
    setPendingAction(orgId);
    try {
      const res = await fetch(`/api/organizations/${orgId}/join`, { method: "POST" });
      if (res.ok) {
        setOverrides((prev) => {
          const next = new Map(prev);
          next.set(orgId, { joined: true, delta: 1 });
          return next;
        });
        await mutateAll();
        await mutateMine();
        setOverrides(new Map());
      }
    } finally {
      setPendingAction(null);
    }
  };

  const handleLeave = async (orgId: string) => {
    setPendingAction(orgId);
    try {
      const res = await fetch(`/api/organizations/${orgId}/leave`, { method: "DELETE" });
      if (res.ok) {
        setOverrides((prev) => {
          const next = new Map(prev);
          next.set(orgId, { joined: false, delta: -1 });
          return next;
        });
        await mutateAll();
        await mutateMine();
        setOverrides(new Map());
      }
    } finally {
      setPendingAction(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Members modal
  // ---------------------------------------------------------------------------

  const openMembersModal = async (org: Organization) => {
    setMembersModalOrg(org);
    setMembers([]);
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/organizations/${org.id}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } finally {
      setLoadingMembers(false);
    }
  };

  const closeMembersModal = () => {
    setMembersModalOrg(null);
    setMembers([]);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl">
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
          Organizations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Join or leave organizations to filter your leaderboard.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Want to add a new organization?{" "}
          <a
            href="https://github.com/nocoo/pew/issues/new?labels=organization&title=[Org]+Request:+"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            Submit a request on GitHub
          </a>
          .
        </p>
      </div>

      {/* Organization List */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
          <Building2 className="h-4 w-4" strokeWidth={1.5} />
          Available Organizations
        </h2>

        {organizations.length === 0 ? (
          <div className="rounded-xl bg-secondary p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No organizations available yet.
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-secondary divide-y divide-border overflow-hidden">
            {organizations.map((org) => {
              const isMember = myOrgIds.has(org.id);
              const isPending = pendingAction === org.id;

              return (
                <div
                  key={org.id}
                  className="flex items-center gap-4 p-4 hover:bg-accent/50 transition-colors cursor-pointer"
                  onClick={() => openMembersModal(org)}
                >
                  {/* Logo */}
                  <Avatar className="h-10 w-10">
                    {org.logoUrl && <AvatarImage src={org.logoUrl} alt={org.name} />}
                    <AvatarFallback className="bg-primary/10 text-primary text-sm">
                      {org.name[0]?.toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {org.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {org.memberCount} {org.memberCount === 1 ? "member" : "members"}
                    </p>
                  </div>

                  {/* Join/Leave button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isPending) return;
                      if (isMember) {
                        handleLeave(org.id);
                      } else {
                        handleJoin(org.id);
                      }
                    }}
                    disabled={isPending}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      isMember
                        ? "bg-primary/10 text-primary hover:bg-primary/20"
                        : "bg-accent text-foreground hover:bg-accent/80 border border-border",
                      isPending && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isMember ? (
                      <>
                        <Check className="h-3.5 w-3.5" strokeWidth={2} />
                        Joined
                      </>
                    ) : (
                      "Join"
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Members Modal */}
      {membersModalOrg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeMembersModal}
        >
          <div
            className="w-full max-w-md mx-4 rounded-xl bg-background border border-border shadow-xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 p-4 border-b border-border">
              <Avatar className="h-8 w-8">
                {membersModalOrg.logoUrl && (
                  <AvatarImage src={membersModalOrg.logoUrl} alt={membersModalOrg.name} />
                )}
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {membersModalOrg.name[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground truncate">
                  {membersModalOrg.name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {membersModalOrg.memberCount} {membersModalOrg.memberCount === 1 ? "member" : "members"}
                </p>
              </div>
              <button
                onClick={closeMembersModal}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Members list */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingMembers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : members.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No members yet.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                    <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Members
                  </div>
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 rounded-lg bg-secondary p-3"
                    >
                      <Avatar className="h-8 w-8">
                        {member.user.image && (
                          <AvatarImage src={member.user.image} alt={member.user.name ?? "User"} />
                        )}
                        <AvatarFallback className="bg-accent text-foreground text-xs">
                          {member.user.name?.[0]?.toUpperCase() ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {member.user.name ?? "Anonymous"}
                        </p>
                        {member.user.slug && (
                          <p className="text-xs text-muted-foreground truncate">
                            @{member.user.slug}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
