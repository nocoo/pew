"use client";

import { Button } from "@nocoo/basalt/components/button";
import { Empty } from "@nocoo/basalt/components/empty";
import { type LucideIcon, Rocket, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  tips?: string[];
  className?: string | undefined;
}

function EmptyState({
  icon: Icon = Zap,
  title,
  description,
  action,
  tips,
  className,
}: EmptyStateProps) {
  const actionNode = action?.href ? (
    <Button asChild icon={<Rocket strokeWidth={1.5} aria-hidden="true" />}>
      <a href={action.href}>{action.label}</a>
    </Button>
  ) : action?.onClick ? (
    <Button icon={<Rocket strokeWidth={1.5} aria-hidden="true" />} onClick={action.onClick}>
      {action.label}
    </Button>
  ) : undefined;

  return (
    <Empty
      icon={<Icon strokeWidth={1.5} />}
      title={title}
      description={description}
      className={cn("rounded-basalt-card bg-basalt-secondary p-8 md:p-12", className)}
      {...(actionNode ? { action: actionNode } : {})}
    >
      {tips && tips.length > 0 ? (
        <ol className="mx-auto max-w-sm space-y-2 text-left">
          {tips.map((tip, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: `tips` is a compile-time constant array passed as a prop; positional key is authoritative for the numbered list.
            <li key={`${tip}-${i}`} className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-basalt-primary/10 text-xs font-semibold text-basalt-primary">
                {i + 1}
              </span>
              <span>{tip}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </Empty>
  );
}

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
