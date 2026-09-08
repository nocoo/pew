"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Building2, Users, Check, Loader2, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@nocoo/basalt/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nocoo/basalt/components/dialog";
import { Banner } from "@nocoo/basalt/components/banner";
import { Empty } from "@nocoo/basalt/components/empty";
import { chromeIconClassName } from "@/lib/ghost-icon";
import { PageHeader } from "@nocoo/basalt/components/page-header";

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
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasMembersOpenRef = useRef(false);
  if (membersModalOrg !== null && !wasMembersOpenRef.current) {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasMembersOpenRef.current = membersModalOrg !== null;
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
        <Banner variant="error" description={error} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Organizations"
        description={
          <>
            Join or leave organizations to filter your leaderboard. Want to add a new
            organization?{" "}
            <a
              href="https://github.com/nocoo/pew/issues/new?labels=organization&title=[Org]+Request:+"
              target="_blank"
              rel="noopener noreferrer"
              className="text-basalt-primary hover:underline"
            >
              Submit a request on GitHub
            </a>
            .
          </>
        }
      />

      {/* Organization List */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
          <Building2 className="h-4 w-4" strokeWidth={1.5} />
          Available Organizations
        </h2>

        {organizations.length === 0 ? (
          <Empty
            title="No organizations available yet."
            className="rounded-basalt-card bg-basalt-secondary p-8"
          />
        ) : (
          <div className="rounded-xl bg-secondary divide-y divide-border overflow-hidden">
            {organizations.map((org) => {
              const isMember = myOrgIds.has(org.id);
              const isPending = pendingAction === org.id;

              return (
                <div
                  key={org.id}
                  className="flex items-center gap-4 p-4 hover:bg-accent/50 transition-colors"
                >
                  {/* Logo */}
                  <Avatar className="h-10 w-10">
                    {org.logoUrl && <AvatarImage src={org.logoUrl} alt={org.name} />}
                    <AvatarFallback className="bg-primary/10 text-primary text-sm">
                      {org.name[0]?.toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>

                  {/* Info */}
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start px-0 py-0 text-left hover:bg-transparent"
                    onClick={() => openMembersModal(org)}
                    aria-label={`View members of ${org.name}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {org.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {org.memberCount} {org.memberCount === 1 ? "member" : "members"}
                      </span>
                    </span>
                  </Button>

                  {/* Join/Leave button */}
                  <Button
                    type="button"
                    size="sm"
                    variant={isMember ? "secondary" : "default"}
                    onClick={() => {
                      if (isPending) return;
                      if (isMember) {
                        handleLeave(org.id);
                      } else {
                        handleJoin(org.id);
                      }
                    }}
                    disabled={isPending}
                    loading={isPending}
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
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Dialog open={membersModalOrg !== null} onOpenChange={(next) => { if (!next) closeMembersModal(); }}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocusRef.current?.focus();
          }}
        >
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`absolute top-4 right-4 ${chromeIconClassName}`}
              aria-label="Close"
            >
              <X aria-hidden="true" strokeWidth={1.5} />
            </Button>
          </DialogClose>
          {membersModalOrg ? (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 pr-8">
                  <Avatar className="h-8 w-8">
                    {membersModalOrg.logoUrl && (
                      <AvatarImage src={membersModalOrg.logoUrl} alt={membersModalOrg.name} />
                    )}
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {membersModalOrg.name[0]?.toUpperCase() ?? "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <DialogTitle className="truncate text-sm">
                      {membersModalOrg.name}
                    </DialogTitle>
                    <DialogDescription>
                      {membersModalOrg.memberCount}{" "}
                      {membersModalOrg.memberCount === 1 ? "member" : "members"}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="mt-4">
                {loadingMembers ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : members.length === 0 ? (
                  <Empty title="No members yet." />
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
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
