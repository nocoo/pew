"use client";

import type { ComponentProps, CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { ResponsiveContainer as RechartsResponsiveContainer } from "recharts";
import { useSidebarAnimation } from "@/components/layout/sidebar-animation";
import { CHART_RESIZE_DEBOUNCE_MS, chartResizeDebounceMs } from "@/lib/sidebar-animation";

type DashboardResponsiveContainerProps = ComponentProps<typeof RechartsResponsiveContainer>;

export function DashboardResponsiveContainer({
  debounce = CHART_RESIZE_DEBOUNCE_MS,
  ...props
}: DashboardResponsiveContainerProps) {
  const { animating } = useSidebarAnimation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [frozen, setFrozen] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    if (!animating) {
      setFrozen(null);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setFrozen({ width: rect.width, height: rect.height });
  }, [animating]);

  const wrapStyle: CSSProperties | undefined = frozen
    ? { width: frozen.width, height: frozen.height, flex: "none" }
    : undefined;

  return (
    <div ref={wrapRef} className="h-full w-full" style={wrapStyle}>
      <RechartsResponsiveContainer
        debounce={animating ? chartResizeDebounceMs(true) : debounce}
        {...props}
      />
    </div>
  );
}
