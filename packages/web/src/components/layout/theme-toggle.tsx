"use client";

import { ThemeToggle as BasaltThemeToggle } from "@nocoo/basalt/components/theme-toggle";
import { useTheme } from "@nocoo/basalt/providers/theme";

export function ThemeToggle() {
  const { theme } = useTheme();
  return <BasaltThemeToggle aria-label={`Toggle theme (now ${theme})`} />;
}
