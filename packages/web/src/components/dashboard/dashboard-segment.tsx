import { SectionRule } from "@nocoo/basalt/components/section-rule";
import type { ReactNode } from "react";

export interface DashboardSegmentProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function DashboardSegment({ title, action, children, className }: DashboardSegmentProps) {
  return (
    <SectionRule title={title} actions={action} className={className}>
      {children}
    </SectionRule>
  );
}
