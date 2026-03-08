"use client";

import { Clock, MessageSquare, Timer, Hash } from "lucide-react";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import type { SessionOverview as SessionOverviewData } from "@/lib/session-helpers";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SessionOverviewProps {
  data: SessionOverviewData;
  subtitle?: string;
  className?: string;
}

/**
 * Four stat cards summarising session metrics:
 * total sessions, total hours, avg duration, avg messages.
 */
export function SessionOverview({
  data,
  subtitle,
  className,
}: SessionOverviewProps) {
  return (
    <StatGrid columns={4} {...(className ? { className } : {})}>
      <StatCard
        title="Sessions"
        value={data.totalSessions}
        {...(subtitle ? { subtitle } : {})}
        icon={Hash}
        iconColor="text-primary"
      />
      <StatCard
        title="Total Hours"
        value={data.totalHours.toFixed(1)}
        subtitle="Wall-clock time"
        icon={Clock}
        iconColor="text-chart-2"
      />
      <StatCard
        title="Avg Duration"
        value={`${Math.round(data.avgDurationMinutes)}m`}
        subtitle="Per session"
        icon={Timer}
        iconColor="text-chart-3"
      />
      <StatCard
        title="Avg Messages"
        value={Math.round(data.avgMessages)}
        subtitle="Per session"
        icon={MessageSquare}
        iconColor="text-chart-4"
      />
    </StatGrid>
  );
}
