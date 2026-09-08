"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Sidebar as BasaltSidebar,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarUser,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nocoo/basalt";
import {
  LayoutDashboard,
  Settings,
  PanelLeft,
  LogOut,
  Trophy,
  CalendarDays,
  Clock,
  AppWindow,
  Cpu,
  Monitor,
  MonitorSmartphone,
  MessagesSquare,
  DollarSign,
  Tag,
  Users,
  Ticket,
  ArrowUpRight,
  FolderKanban,
  FolderGit2,
  Database,
  Star,
  Building2,
  Medal,
  GitCompareArrows,
} from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { ElementType } from "react";
import { useAdmin } from "@/hooks/use-admin";
import {
  ADMIN_NAV_GROUP,
  BASE_NAV_GROUPS,
  type NavGroupDef,
} from "@/lib/navigation";
import { APP_VERSION } from "@/lib/version";
import { ghostIconClassName } from "@/components/ui/button";

const ICON_MAP: Record<string, ElementType> = {
  LayoutDashboard,
  Settings,
  Trophy,
  CalendarDays,
  Clock,
  MessagesSquare,
  AppWindow,
  Cpu,
  Monitor,
  MonitorSmartphone,
  Users,
  DollarSign,
  Tag,
  Ticket,
  ArrowUpRight,
  FolderKanban,
  FolderGit2,
  Database,
  Star,
  Building2,
  Medal,
  GitCompareArrows,
};

interface NavItem {
  href: string;
  label: string;
  icon: ElementType;
  external?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

function resolveNavGroup(def: NavGroupDef): NavGroup {
  return {
    label: def.label,
    ...(def.defaultOpen != null && { defaultOpen: def.defaultOpen }),
    items: def.items.map((item) => ({
      href: item.href,
      label: item.label,
      icon: ICON_MAP[item.icon] ?? Settings,
      ...(item.external != null && { external: item.external }),
    })),
  };
}

function getNavGroups(isAdmin: boolean): NavGroup[] {
  const base = BASE_NAV_GROUPS.map(resolveNavGroup);
  return isAdmin ? [...base, resolveNavGroup(ADMIN_NAV_GROUP)] : base;
}

function isActivePath(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}

function openNavItem(href: string, external: boolean | undefined, push: (href: string) => void) {
  if (external) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  push(href);
}

function PewMark() {
  return (
    <Image src="/logo-24.png" alt="pew" width={24} height={24} className="shrink-0" />
  );
}

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { isAdmin } = useAdmin();

  const navGroups = getNavGroups(isAdmin);
  const allNavItems = navGroups.flatMap((g) => g.items);

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const userImage = session?.user?.image;
  const userInitial = userName[0] ?? "?";

  const avatar = (
    <Avatar className="h-9 w-9 shrink-0">
      {userImage ? <AvatarImage src={userImage} alt={userName} /> : null}
      <AvatarFallback className="text-xs bg-basalt-primary text-basalt-primary-foreground">
        {userInitial}
      </AvatarFallback>
    </Avatar>
  );

  if (collapsed) {
    return (
      <BasaltSidebar collapsed>
        <SidebarHeader className="justify-start px-0 pl-6">
          <PewMark />
        </SidebarHeader>
        <Button
          variant="ghost"
          size="icon"
          className={`${ghostIconClassName} mb-2 h-10 w-10 self-center hover:bg-basalt-accent`}
          onClick={onToggle}
          aria-label="Expand sidebar"
        >
          <PanelLeft aria-hidden="true" strokeWidth={1.5} />
        </Button>
        <SidebarNav className="w-full items-center gap-1 pt-1">
          {allNavItems.map((item) => (
            <Tooltip key={item.href} delayDuration={0}>
              <TooltipTrigger asChild>
                <SidebarIconItem
                  active={!item.external && isActivePath(pathname, item.href)}
                  aria-label={item.label}
                  className="self-center"
                  onClick={() => openNavItem(item.href, item.external, router.push)}
                >
                  <item.icon className="h-4 w-4" strokeWidth={1.5} />
                </SidebarIconItem>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {item.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </SidebarNav>
        <SidebarFooter className="flex w-full justify-center px-0">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="h-9 w-9 p-0"
                onClick={() => signOut({ callbackUrl: "/login" })}
                aria-label={`${userName} · Click to sign out`}
              >
                {avatar}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {userName} · Click to sign out
            </TooltipContent>
          </Tooltip>
        </SidebarFooter>
      </BasaltSidebar>
    );
  }

  return (
    <BasaltSidebar collapsed={false}>
      <SidebarHeader>
        <div className="flex w-full items-center justify-between">
          <div className="flex min-w-0 items-center gap-3 pl-3">
            <PewMark />
            <span className="mt-[-12px] truncate font-handwriting text-[31px] font-bold tracking-tighter text-basalt-foreground">
              pew
            </span>
            <span className="shrink-0 rounded-md bg-basalt-secondary px-1.5 py-0.5 text-[10px] leading-none font-medium text-basalt-muted-foreground">
              v{APP_VERSION}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={`${ghostIconClassName} h-7 w-7 shrink-0`}
            onClick={onToggle}
            aria-label="Collapse sidebar"
          >
            <PanelLeft aria-hidden="true" strokeWidth={1.5} />
          </Button>
        </div>
      </SidebarHeader>
      <SidebarNav className="pt-1">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label} label={group.label} defaultOpen={group.defaultOpen ?? true}>
            {group.items.map((item) => (
              <SidebarItem
                key={item.href}
                active={!item.external && isActivePath(pathname, item.href)}
                onClick={() => openNavItem(item.href, item.external, router.push)}
              >
                <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1 truncate text-left">{item.label}</span>
                {item.external ? (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                    <ArrowUpRight
                      className="h-3 w-3 text-basalt-muted-foreground"
                      strokeWidth={1.5}
                    />
                  </span>
                ) : null}
              </SidebarItem>
            ))}
          </SidebarGroup>
        ))}
      </SidebarNav>
      <SidebarFooter>
        <SidebarUser
          name={userName}
          email={userEmail}
          avatar={avatar}
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`${ghostIconClassName} h-8 w-8 shrink-0 hover:bg-basalt-accent`}
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  aria-label="Sign out"
                >
                  <LogOut aria-hidden="true" strokeWidth={1.5} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Sign out</TooltipContent>
            </Tooltip>
          }
        />
      </SidebarFooter>
    </BasaltSidebar>
  );
}
