"use client";

import { Button } from "@nocoo/basalt/components/button";
import { useTheme } from "@nocoo/basalt/providers/theme";
import { Monitor, Moon, Sun } from "lucide-react";
import { chromeIconClassName } from "@/lib/ghost-icon";
import { HeaderTooltip } from "./hexly-link";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const nextTheme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const label = nextTheme === "system" ? "Use system theme" : `Switch to ${nextTheme} theme`;
  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;
  return (
    <HeaderTooltip label={label}>
      <Button
        variant="ghost"
        size="icon"
        className={chromeIconClassName}
        onClick={() => setTheme(nextTheme)}
        aria-label="Toggle theme"
      >
        <Icon aria-hidden="true" strokeWidth={1.5} />
      </Button>
    </HeaderTooltip>
  );
}
