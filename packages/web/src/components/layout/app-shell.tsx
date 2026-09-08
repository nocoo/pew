"use client";

import { AppHeader } from "@nocoo/basalt/components/app-header";
import { AppMain, AppShell as BasaltAppShell, AppSkipLink } from "@nocoo/basalt/components/app-shell";
import { Button, ContentIsland, Sheet, SheetContent, SheetTitle } from "@nocoo/basalt";
import { Menu, ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Github } from "@/components/icons/github";
import { Sidebar } from "./sidebar";
import { SidebarAnimationProvider, useSidebarAnimation } from "./sidebar-animation";
import { ThemeToggle } from "./theme-toggle";
import { useIsMobile } from "@/hooks/use-mobile";
import { breadcrumbsFromPathname } from "@/lib/navigation";

interface AppShellProps {
  children: React.ReactNode;
}

function AppShellInner({ children }: AppShellProps) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { begin: beginSidebarAnimation } = useSidebarAnimation();
  const pathname = usePathname();
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      setMobileOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const items = breadcrumbsFromPathname(pathname);
  const current = items.at(-1);
  const crumbs = items.slice(0, -1);
  const title = current?.label ?? "";

  return (
    <BasaltAppShell>
      <AppSkipLink>Skip to main content</AppSkipLink>
      {!isMobile ? (
        <Sidebar
          collapsed={collapsed}
          onToggle={() => {
            beginSidebarAnimation();
            setCollapsed((v) => !v);
          }}
        />
      ) : (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-[260px] max-w-[260px] border-0 bg-basalt-background p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      )}
      <AppMain>
        <AppHeader
          leading={
            isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
              >
                <Menu aria-hidden="true" />
              </Button>
            ) : null
          }
          breadcrumbs={crumbs}
          title={title}
          actions={
            <>
              <Button variant="ghost" size="icon" asChild>
                <a href="/privacy" aria-label="Privacy policy">
                  <ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.5} />
                </a>
              </Button>
              <Button variant="ghost" size="icon" asChild>
                <a
                  href="https://github.com/nocoo/pew"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="GitHub repository"
                >
                  <Github className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.5} />
                </a>
              </Button>
              <ThemeToggle />
            </>
          }
        />
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 md:px-3 md:pb-3">
          <ContentIsland>{children}</ContentIsland>
        </div>
      </AppMain>
    </BasaltAppShell>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <SidebarAnimationProvider>
      <AppShellInner>{children}</AppShellInner>
    </SidebarAnimationProvider>
  );
}
