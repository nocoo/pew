"use client";

import "@/basalt-tw-source";
import { TooltipProvider } from "@nocoo/basalt/components/tooltip";
import { AccentProvider } from "@nocoo/basalt/providers/accent";
import { LinkProvider } from "@nocoo/basalt/providers/link";
import { ThemeProvider } from "@nocoo/basalt/providers/theme";
import NextLink from "next/link";
import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth-provider";

/** Electric Violet — pew brand accent, locked as the default primary. */
const PEW_ACCENT = {
  primary: { light: "270 85% 52%", dark: "270 90% 65%" },
};

function AppLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
}) {
  if (/^(https?:|mailto:|tel:)/.test(href)) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <NextLink href={href} className={className}>
      {children}
    </NextLink>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AccentProvider defaultAccent="primary" persist={false} paletteOverrides={PEW_ACCENT}>
        <LinkProvider render={AppLink}>
          <TooltipProvider delayDuration={0}>
            <AuthProvider>{children}</AuthProvider>
          </TooltipProvider>
        </LinkProvider>
      </AccentProvider>
    </ThemeProvider>
  );
}
