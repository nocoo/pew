"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@nocoo/basalt";
import {
  Sidebar as BasaltSidebar,
  SidebarBrand,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconItem,
  SidebarItem,
  SidebarNav,
  SidebarToggle,
  SidebarUser,
  useSidebar,
} from "@nocoo/basalt/components/sidebar";
import {
  LayoutDashboard,
  Settings,
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
  Database,
  Building2,
  GitCompareArrows,
} from "@nocoo/basalt/icons";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { ElementType } from "react";
import { useAdmin } from "@/hooks/use-admin";
import { ADMIN_NAV_GROUP, BASE_NAV_GROUPS, type NavGroupDef } from "@/lib/navigation";
import { APP_VERSION } from "@/lib/version";

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
  Database,
  Building2,
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

interface SidebarProps {
  resizable?: boolean;
  onDismiss?: () => void;
}

export function Sidebar({ resizable = true, onDismiss }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const { isAdmin } = useAdmin();
  const { collapsed } = useSidebar();

  const navGroups = getNavGroups(isAdmin);

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";
  const userImage = session?.user?.image;
  const userInitial = userName[0] ?? "?";

  const avatar = (
    <Avatar>
      {userImage ? <AvatarImage src={userImage} alt={userName} /> : null}
      <AvatarFallback>{userInitial}</AvatarFallback>
    </Avatar>
  );

  return (
    <BasaltSidebar resizable={resizable}>
      <SidebarHeader>
        <SidebarBrand
          logo={
            <Link href="/dashboard" aria-label="pew home">
              <Image src="/logo-80.png" alt="" width={24} height={24} />
            </Link>
          }
          name="pew"
          version={`v${APP_VERSION}`}
          action={
            onDismiss ? <SidebarToggle mode="dismiss" onDismiss={onDismiss} /> : <SidebarToggle />
          }
        />
      </SidebarHeader>
      <SidebarNav aria-label="Workspace navigation">
        {collapsed
          ? navGroups.flatMap((group) =>
              group.items.map((item) => (
                <SidebarIconItem
                  key={item.href}
                  active={!item.external && isActivePath(pathname, item.href)}
                  onClick={() => openNavItem(item.href, item.external, router.push)}
                >
                  <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span className="sr-only">{item.label}</span>
                </SidebarIconItem>
              )),
            )
          : navGroups.map((group) => (
              <SidebarGroup
                key={group.label}
                label={group.label}
                defaultOpen={group.defaultOpen ?? true}
              >
                {group.items.map((item) => (
                  <SidebarItem
                    key={item.href}
                    active={!item.external && isActivePath(pathname, item.href)}
                    onClick={() => openNavItem(item.href, item.external, router.push)}
                  >
                    <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span className="flex-1 truncate text-left">{item.label}</span>
                    {item.external ? (
                      <ArrowUpRight
                        className="h-basalt-4 w-basalt-4 shrink-0 text-basalt-muted-foreground"
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
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
          onSignOut={() => void signOut({ callbackUrl: "/login" })}
        />
      </SidebarFooter>
    </BasaltSidebar>
  );
}
