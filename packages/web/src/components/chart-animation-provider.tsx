"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimationControllerProvider } from "recharts";
import { createChartAnimationController } from "@/lib/chart-animation";
import { CHART_RESIZE_DEBOUNCE_MS, SIDEBAR_TRANSITION_MS } from "@/lib/sidebar-animation";

const SidebarPauseContext = createContext<(() => void) | null>(null);
const ChartResizePausedContext = createContext(false);

export function ChartAnimationProvider({ children }: { children: ReactNode }) {
  const [playback] = useState(createChartAnimationController);
  const [paused, setPaused] = useState(false);
  const resumeTimer = useRef<number | undefined>(undefined);

  const pauseForSidebar = useCallback(() => {
    window.clearTimeout(resumeTimer.current);
    playback.pause();
    setPaused(true);
    document.documentElement.style.setProperty("--chart-animation-play-state", "paused");
    // Let sidebar motion and layout settle before measuring and resuming once.
    resumeTimer.current = window.setTimeout(() => {
      setPaused(false);
      playback.resume();
      document.documentElement.style.setProperty("--chart-animation-play-state", "running");
    }, SIDEBAR_TRANSITION_MS + CHART_RESIZE_DEBOUNCE_MS);
  }, [playback]);

  useEffect(() => {
    setPaused(false);
    playback.resume();
    return () => {
      window.clearTimeout(resumeTimer.current);
      playback.pause();
      document.documentElement.style.removeProperty("--chart-animation-play-state");
    };
  }, [playback]);

  return (
    <SidebarPauseContext.Provider value={pauseForSidebar}>
      <AnimationControllerProvider value={playback.controller}>
        <ChartResizePausedContext.Provider value={paused}>
          {children}
        </ChartResizePausedContext.Provider>
      </AnimationControllerProvider>
    </SidebarPauseContext.Provider>
  );
}

export function usePauseChartsForSidebar() {
  const pause = useContext(SidebarPauseContext);
  if (!pause) throw new Error("usePauseChartsForSidebar requires ChartAnimationProvider");
  return pause;
}

export function useChartResizePaused() {
  return useContext(ChartResizePausedContext);
}
