"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SIDEBAR_TRANSITION_MS } from "@/lib/sidebar-animation";

interface SidebarAnimationValue {
  animating: boolean;
  begin: () => void;
}

const SidebarAnimationContext = createContext<SidebarAnimationValue>({
  animating: false,
  begin: () => {
    /* charts outside AppShell have no sidebar motion to freeze */
  },
});

export function SidebarAnimationProvider({ children }: { children: ReactNode }) {
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const begin = useCallback(() => {
    setAnimating(true);
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setAnimating(false);
      timerRef.current = undefined;
    }, SIDEBAR_TRANSITION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const value = useMemo(() => ({ animating, begin }), [animating, begin]);

  return (
    <SidebarAnimationContext.Provider value={value}>{children}</SidebarAnimationContext.Provider>
  );
}

export function useSidebarAnimation(): SidebarAnimationValue {
  return useContext(SidebarAnimationContext);
}
