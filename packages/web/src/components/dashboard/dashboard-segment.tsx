import { SectionRule } from "@nocoo/basalt/components/section-rule";
import type { ReactNode } from "react";

export interface DashboardSegmentProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

export function DashboardSegment({ title, action, hint, children, className }: DashboardSegmentProps) {
  return (
    <SectionRule title={title} actions={action} hint={hint} className={className}>
      {children}
    </SectionRule>
  );
}
