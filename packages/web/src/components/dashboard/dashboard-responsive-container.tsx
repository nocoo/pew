"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { ResponsiveContainer as RechartsResponsiveContainer } from "recharts";
import { useChartResizePaused } from "@/components/chart-animation-provider";
import { CHART_RESIZE_DEBOUNCE_MS } from "@/lib/sidebar-animation";

type DashboardResponsiveContainerProps = Pick<
  ComponentProps<typeof RechartsResponsiveContainer>, "width" | "height" | "children" | "debounce"
>;

export function DashboardResponsiveContainer({
  width = "100%",
  height = "100%",
  children,
  debounce = CHART_RESIZE_DEBOUNCE_MS,
}: DashboardResponsiveContainerProps) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const paused = useChartResizePaused();

  useLayoutEffect(() => {
    const node = container.current;
    if (!node || paused) return;
    let timer: number | undefined;
    const measure = () => {
      // Layout dimensions stay correct even while a dialog scales into view.
      const width = node.clientWidth;
      const height = node.clientHeight;
      setSize((previous) => previous.width === width && previous.height === height
        ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, debounce);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [paused, debounce]);

  // Recharts' own observer cannot pause and may finish an Area animation on resize.
  // Keep its dimension provider mounted, holding the last size during sidebar motion.
  return (
    <div ref={container} className="recharts-responsive-container overflow-hidden" style={{ width, height, minWidth: 0 }}>
      <RechartsResponsiveContainer width={size.width} height={size.height}>
        {children}
      </RechartsResponsiveContainer>
    </div>
  );
}
