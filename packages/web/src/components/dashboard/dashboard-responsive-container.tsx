"use client";

import type { ComponentProps } from "react";
import { ResponsiveContainer as RechartsResponsiveContainer } from "recharts";

const CHART_RESIZE_DEBOUNCE_MS = 180;

type DashboardResponsiveContainerProps = ComponentProps<
  typeof RechartsResponsiveContainer
>;

export function DashboardResponsiveContainer({
  debounce = CHART_RESIZE_DEBOUNCE_MS,
  ...props
}: DashboardResponsiveContainerProps) {
  return <RechartsResponsiveContainer debounce={debounce} {...props} />;
}
