"use client";

import { type LucideIcon, Rocket, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  /** Icon displayed at the top */
  icon?: LucideIcon;
  /** Main headline */
  title: string;
  /** Supporting description */
  description: string;
  /** Call-to-action button */
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  /** Additional tips or steps shown below the main content */
  tips?: string[];
  className?: string | undefined;
}

// ---------------------------------------------------------------------------
// EmptyState Component
// ---------------------------------------------------------------------------

/**
 * Empty state component for pages with no data.
 *
 * Designed to guide and encourage users rather than just say "nothing here."
 * Features:
 * - Energetic icon with brand-colored accent
 * - Clear title and helpful description
 * - Optional CTA button
 * - Optional tips/steps list
 */
export function EmptyState({
  icon: Icon = Zap,
  title,
  description,
  action,
  tips,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-card bg-secondary p-8 md:p-12 text-center",
        className
      )}
    >
      {/* Icon with gradient background */}
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-chart-8/20">
        <Icon
          className="h-8 w-8 text-primary"
          strokeWidth={1.5}
        />
      </div>

      {/* Title */}
      <h3 className="text-lg md:text-xl font-semibold font-display text-foreground">
        {title}
      </h3>

      {/* Description */}
      <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
        {description}
      </p>

      {/* CTA Button */}
      {action && (
        <div className="mt-6">
          {action.href ? (
            <a
              href={action.href}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Rocket className="h-4 w-4" strokeWidth={1.5} />
              {action.label}
            </a>
          ) : action.onClick ? (
            <button
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Rocket className="h-4 w-4" strokeWidth={1.5} />
              {action.label}
            </button>
          ) : null}
        </div>
      )}

      {/* Tips/Steps */}
      {tips && tips.length > 0 && (
        <div className="mt-8 border-t border-border/50 pt-6">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Getting Started
          </p>
          <ol className="text-left max-w-sm mx-auto space-y-2">
            {tips.map((tip, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {i + 1}
                </span>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preset Empty States
// ---------------------------------------------------------------------------

/** Dashboard empty state — encourages first-time users */
export function DashboardEmptyState({ className }: { className?: string }) {
  return (
    <EmptyState
      icon={Zap}
      title="Ready to Track Your AI Usage"
      description="Connect your first AI coding tool and watch your token usage come to life. We'll show you insights, trends, and achievements."
      action={{
        label: "Get Started",
        href: "/agents",
      }}
      tips={[
        "Install the pew CLI on your machine",
        "Configure hooks for Claude Code, Cursor, or Copilot",
        "Start coding — we'll track everything automatically",
      ]}
      className={className}
    />
  );
}

/** Projects empty state */
export function ProjectsEmptyState({
  className,
  isFilterEmpty,
  filterValue,
}: {
  className?: string | undefined;
  isFilterEmpty?: boolean;
  filterValue?: string;
}) {
  if (isFilterEmpty) {
    return (
      <EmptyState
        icon={Zap}
        title="No Matching Projects"
        description={`No projects match the filter "${filterValue}". Try a different filter or clear it to see all projects.`}
        className={className}
      />
    );
  }

  return (
    <EmptyState
      icon={Zap}
      title="No Projects Yet"
      description="Projects appear automatically when you work on different codebases. Each git repository you code in becomes a project."
      tips={[
        "Open a project in your editor with an AI tool enabled",
        "Make some edits — we'll detect the project automatically",
        "Come back here to see project-level breakdowns",
      ]}
      className={className}
    />
  );
}

/** Devices empty state */
export function DevicesEmptyState({ className }: { className?: string }) {
  return (
    <EmptyState
      icon={Zap}
      title="No Devices Registered"
      description="Devices are automatically detected when you sync usage from your AI coding tools. Each machine you work on will appear here."
      tips={[
        "Install pew CLI on your workstation or laptop",
        "Run the sync command to register your device",
        "Manage device aliases and view per-device stats here",
      ]}
      className={className}
    />
  );
}
