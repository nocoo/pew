"use client";

import { ThemeToggle as BasaltThemeToggle } from "@nocoo/basalt/components/theme-toggle";

export function ThemeToggle() {
  return (
    <span className="inline-flex [&_button]:h-8 [&_button]:w-8 [&_button]:text-basalt-muted-foreground [&_button:hover]:text-basalt-foreground">
      <BasaltThemeToggle aria-label="Toggle theme" />
    </span>
  );
}
