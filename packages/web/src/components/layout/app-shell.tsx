"use client";

import Link from "next/link";
import { AppHeader, AppHeaderMenuButton } from "@nocoo/basalt/components/app-header";
import {
  AppMain,
  AppShell as BasaltAppShell,
  AppSkipLink,
} from "@nocoo/basalt/components/app-shell";
import { Button, ContentIsland, Tooltip, TooltipContent, TooltipTrigger } from "@nocoo/basalt";
import { SidebarDrawer, SidebarProvider } from "@nocoo/basalt/components/sidebar";
import { ShieldCheck } from "@nocoo/basalt/icons";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePauseChartsForSidebar } from "@/components/chart-animation-provider";
import { Github } from "@/components/icons/github";
import { HexlyLink } from "./hexly-link";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { useIsMobile } from "@/hooks/use-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const prevPathname = useRef(pathname);
  const pauseCharts = usePauseChartsForSidebar();
  const changeMobileOpen = useCallback(
    (open: boolean) => {
      if (open === mobileOpen) return;
      pauseCharts();
      setMobileOpen(open);
    },
    [mobileOpen, pauseCharts],
  );

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      changeMobileOpen(false);
    }
  }, [pathname, changeMobileOpen]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const items = breadcrumbsFromPathname(pathname);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerId = useId();

  return (
    <BasaltAppShell>
      <AppSkipLink>Skip to main content</AppSkipLink>
      {!isMobile ? (
        <SidebarProvider
          collapsed={collapsed}
          onCollapsedChange={(next) => {
            pauseCharts();
            setCollapsed(next);
          }}
        >
          <Sidebar />
        </SidebarProvider>
      ) : (
        <SidebarDrawer
          id={mobileDrawerId}
          open={mobileOpen}
          onOpenChange={changeMobileOpen}
          returnFocusRef={mobileTriggerRef}
          title="Navigation"
          description="Workspace navigation links and account"
        >
          <Sidebar resizable={false} onDismiss={() => changeMobileOpen(false)} />
        </SidebarDrawer>
      )}
      <AppMain>
        <AppHeader
          leading={
            isMobile ? (
              <AppHeaderMenuButton
                ref={mobileTriggerRef}
                label="Open navigation"
                aria-controls={mobileDrawerId}
                onClick={() => changeMobileOpen(true)}
              />
            ) : null
          }
          breadcrumbs={items}
          actions={
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" asChild>
                    <Link href="/privacy" aria-label="Privacy policy">
                      <ShieldCheck aria-hidden="true" strokeWidth={1.5} />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Privacy policy</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" asChild>
                    <a
                      href="https://github.com/nocoo/pew"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="GitHub repository"
                    >
                      <Github aria-hidden="true" strokeWidth={1.5} />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">GitHub repository</TooltipContent>
              </Tooltip>
              <HexlyLink />
              <ThemeToggle />
            </>
          }
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col px-basalt-space-lg pb-basalt-space-lg md:px-basalt-layout-sm md:pb-basalt-layout-sm">
          <ContentIsland>{children}</ContentIsland>
        </div>
      </AppMain>
    </BasaltAppShell>
  );
}
