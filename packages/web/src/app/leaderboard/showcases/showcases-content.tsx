/**
 * Client component for showcases list.
 */

"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShowcases, type Showcase } from "@/hooks/use-showcases";
import { ShowcaseCard, ShowcaseFormModal } from "@/components/showcase";
import { UserProfileDialog } from "@/components/user-profile-dialog";

interface ShowcasesContentProps {
  isLoggedIn: boolean;
}

const PAGE_SIZE = 20;

export function ShowcasesContent({ isLoggedIn }: ShowcasesContentProps) {
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const [showModal, setShowModal] = useState(false);

  // User profile dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogUser, setDialogUser] = useState<Showcase["user"] | null>(null);

  const { data, loading, refreshing, error, refetch } = useShowcases({
    limit: PAGE_SIZE,
    offset,
  });

  const handleLoginRequired = useCallback(() => {
    router.push("/login");
  }, [router]);

  const handleAddSuccess = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleUserClick = useCallback((user: Showcase["user"]) => {
    setDialogUser(user);
    setDialogOpen(true);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3 animate-pulse pt-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-[120px] rounded-xl bg-secondary" />
        ))}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive mt-4">
        Failed to load showcases: {error}
      </div>
    );
  }

  const showcases = data?.showcases ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div
      className="space-y-4 animate-fade-up"
      style={{ animationDelay: "180ms" }}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "showcase" : "showcases"}
          </span>
          <button
            onClick={() => refetch()}
            disabled={refreshing}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
              refreshing && "animate-spin"
            )}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </div>

        {isLoggedIn && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Add Showcase
          </button>
        )}
      </div>

      {/* Empty state */}
      {showcases.length === 0 && (
        <div className="rounded-xl bg-secondary p-8 text-center">
          <p className="text-muted-foreground">
            No showcases yet. Be the first to share a project!
          </p>
          {isLoggedIn && (
            <button
              onClick={() => setShowModal(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" strokeWidth={1.5} />
              Add Showcase
            </button>
          )}
        </div>
      )}

      {/* Showcase list */}
      <div className="space-y-3">
        {showcases.map((showcase) => (
          <ShowcaseCard
            key={showcase.id}
            showcase={showcase}
            isLoggedIn={isLoggedIn}
            onLoginRequired={handleLoginRequired}
            onUpvoteChange={refetch}
            onUserClick={handleUserClick}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-border transition-colors",
              offset === 0
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-accent hover:text-foreground"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="text-sm text-muted-foreground tabular-nums px-2">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={currentPage >= totalPages}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-border transition-colors",
              currentPage >= totalPages
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-accent hover:text-foreground"
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Add modal */}
      <ShowcaseFormModal
        open={showModal}
        onOpenChange={setShowModal}
        onSuccess={handleAddSuccess}
      />

      {/* User profile dialog - lazy mounted to avoid useAdmin/useSeasons firing while closed */}
      {dialogOpen && (
        <UserProfileDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          slug={dialogUser?.slug ?? dialogUser?.id ?? null}
          name={dialogUser?.nickname ?? dialogUser?.name ?? null}
          image={dialogUser?.image ?? null}
        />
      )}
    </div>
  );
}
