"use client";

import type { ComponentProps } from "react";
import { ResponsiveContainer as RechartsResponsiveContainer } from "recharts";
import { CHART_RESIZE_DEBOUNCE_MS } from "@/lib/sidebar-animation";

type DashboardResponsiveContainerProps = ComponentProps<typeof RechartsResponsiveContainer>;

export function DashboardResponsiveContainer({
  debounce = CHART_RESIZE_DEBOUNCE_MS,
  ...props
}: DashboardResponsiveContainerProps) {
  return <RechartsResponsiveContainer debounce={debounce} {...props} />;
}
